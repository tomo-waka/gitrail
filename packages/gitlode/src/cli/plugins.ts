import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type {
  Namespace,
  PluginEntry,
  PluginFactory,
  PluginFailurePolicy,
  ProjectorPlugin,
} from "../core/index.js";

// ---------------------------------------------------------------------------
// Config file schema types
// ---------------------------------------------------------------------------

export interface PluginExtensionEntry {
  readonly entrypoint: string;
  readonly config?: unknown;
  readonly failurePolicy: PluginFailurePolicy;
}

export interface PluginConfigFile {
  readonly version: 1;
  readonly extensions: Readonly<Record<Namespace, PluginExtensionEntry>>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const NAMESPACE_PATTERN = /^[a-z0-9-]+$/;

function isNamespace(s: string): s is Namespace {
  return NAMESPACE_PATTERN.test(s);
}

const PluginExtensionEntrySchema = z
  .object({
    entrypoint: z.string().min(1, "must be a non-empty string"),
    config: z.unknown().optional(),
    failurePolicy: z.enum(["skip-fact", "fatal"]).default("skip-fact"),
  })
  .strict();

const PluginConfigFileSchema = z
  .object({
    version: z.literal(1),
    extensions: z
      .record(
        z.string().refine(isNamespace, { message: "must match pattern [a-z0-9-]+" }),
        PluginExtensionEntrySchema,
      )
      .refine((ext) => Object.keys(ext).length > 0, {
        message: '"extensions" must contain at least one entry',
      }),
  })
  .strict();

function configError(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function validatePluginConfig(raw: unknown, configPath: string): PluginConfigFile {
  const result = PluginConfigFileSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at "${issue.path.join(".")}"` : "";
      return `${path}: ${issue.message}`;
    });
    configError(`Invalid config file${messages.join("; ")} (${configPath})`);
  }
  // Zod validates all namespace keys via isNamespace; cast bridges the Namespace key type.
  return result.data as unknown as PluginConfigFile;
}

// ---------------------------------------------------------------------------
// Loader pipeline
// ---------------------------------------------------------------------------

/** Read and validate the config file at the given absolute path. */
export async function loadPluginConfig(configPath: string): Promise<PluginConfigFile> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    const msg =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `Config file not found: ${configPath}`
        : `Failed to read config file: ${configPath}`;
    configError(msg);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    configError(`Invalid config file: not valid JSON (${configPath})`);
  }

  return validatePluginConfig(parsed, configPath);
}

/**
 * Resolve plugin entrypoints, invoke their factory functions, and return a
 * list of PluginEntry records. The configPath is used to resolve relative
 * entrypoints.
 */
export async function resolvePluginEntries(
  config: PluginConfigFile,
  configPath: string,
): Promise<PluginEntry[]> {
  const configDir = dirname(configPath);
  const entries: PluginEntry[] = [];

  for (const [namespace, extEntry] of Object.entries(config.extensions)) {
    const { entrypoint, config: pluginConfig, failurePolicy } = extEntry;

    let resolvedSpecifier: string;
    if (entrypoint.startsWith(".") || isAbsolute(entrypoint)) {
      resolvedSpecifier = pathToFileURL(resolve(configDir, entrypoint)).href;
    } else {
      // Bare specifier: resolve from config file's directory using require.resolve
      try {
        const req = createRequire(pathToFileURL(configDir + "/").href);
        resolvedSpecifier = pathToFileURL(req.resolve(entrypoint)).href;
      } catch {
        configError(
          `Cannot resolve plugin entrypoint "${entrypoint}" for namespace "${namespace}"`,
        );
      }
    }

    let mod: unknown;
    try {
      mod = await import(resolvedSpecifier);
    } catch (err) {
      configError(
        `Failed to load plugin "${entrypoint}" for namespace "${namespace}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const factory = (mod as { default?: unknown })?.default;
    if (typeof factory !== "function") {
      configError(
        `Plugin "${entrypoint}" for namespace "${namespace}" does not export a default function`,
      );
    }

    let plugin: ProjectorPlugin;
    try {
      plugin = (await (factory as PluginFactory)(pluginConfig)) as ProjectorPlugin;
    } catch (err) {
      configError(
        `Plugin factory for namespace "${namespace}" threw an error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (typeof plugin !== "object" || plugin === null || typeof plugin.project !== "function") {
      configError(
        `Plugin factory for namespace "${namespace}" did not return a valid ProjectorPlugin`,
      );
    }

    entries.push({ namespace: namespace as Namespace, plugin, failurePolicy });
  }

  return entries;
}

/** Invoke init() on each entry in parallel. Collects all fatal results and exits if any. */
export async function initializePlugins(entries: PluginEntry[]): Promise<void> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      if (typeof entry.plugin.init !== "function") {
        return null;
      }
      try {
        return { entry, result: await entry.plugin.init() };
      } catch (err) {
        return {
          entry,
          result: {
            type: "fatal" as const,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  const fatals = results.filter(
    (r): r is { entry: PluginEntry; result: { type: "fatal"; message: string } } =>
      r !== null && r.result.type === "fatal",
  );

  if (fatals.length > 0) {
    for (const { entry, result } of fatals) {
      process.stderr.write(`Plugin "${entry.namespace}" init failed: ${result.message}\n`);
    }
    process.exit(1);
  }
}
