import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  initializePlugins,
  loadPluginConfig,
  resolvePluginEntries,
} from "../../src/cli/plugins.js";
import type { PluginEntry, PluginInitResult } from "../../src/core/types.js";

let exitSpy: MockInstance;
let stderrSpy: MockInstance;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// loadPluginConfig — JSON parsing and schema validation
// ---------------------------------------------------------------------------

describe("loadPluginConfig – parse and validate", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gitlode-plugins-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses a valid config file and returns PluginConfigFile", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        extensions: {
          "my-plugin": { entrypoint: "./plugin.js" },
        },
      }),
    );
    const config = await loadPluginConfig(configPath);
    expect(config.version).toBe(1);
    expect(config.extensions["my-plugin"]?.entrypoint).toBe("./plugin.js");
  });

  it("defaults failurePolicy to skip-fact when not specified", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ version: 1, extensions: { p: { entrypoint: "./p.js" } } }),
    );
    const config = await loadPluginConfig(configPath);
    expect(config.extensions["p"]?.failurePolicy).toBe("skip-fact");
  });

  it("preserves explicitly set failurePolicy=fatal", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        extensions: { p: { entrypoint: "./p.js", failurePolicy: "fatal" } },
      }),
    );
    const config = await loadPluginConfig(configPath);
    expect(config.extensions["p"]?.failurePolicy).toBe("fatal");
  });

  it("exits with code 1 for missing version field", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({ extensions: { p: { entrypoint: "./p.js" } } }));
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 for version !== 1", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ version: 2, extensions: { p: { entrypoint: "./p.js" } } }),
    );
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 for missing extensions field", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({ version: 1 }));
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 for empty extensions object", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, JSON.stringify({ version: 1, extensions: {} }));
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 for namespace violating [a-z0-9-]+ pattern", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ version: 1, extensions: { "BAD_NS!": { entrypoint: "./p.js" } } }),
    );
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("BAD_NS!"));
  });

  it("exits with code 1 for unknown top-level field", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        extensions: { p: { entrypoint: "./p.js" } },
        unknown: true,
      }),
    );
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 for invalid JSON", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(configPath, "not json {{{");
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when file does not exist", async () => {
    await expect(loadPluginConfig(join(tmpDir, "nope.json"))).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("exits with code 1 for invalid failurePolicy value", async () => {
    const configPath = join(tmpDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        extensions: { p: { entrypoint: "./p.js", failurePolicy: "unknown-policy" } },
      }),
    );
    await expect(loadPluginConfig(configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// resolvePluginEntries — entrypoint resolution
// ---------------------------------------------------------------------------

describe("resolvePluginEntries – entrypoint resolution", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gitlode-plugins-resolve-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads a local relative entrypoint and returns a PluginEntry", async () => {
    // Write a simple plugin module
    const pluginPath = join(tmpDir, "plugin.mjs");
    await writeFile(
      pluginPath,
      `export default async function factory() {
        return { project: async () => ({ type: "success", data: {} }) };
      }`,
    );

    const configPath = join(tmpDir, "config.json");
    const config = {
      version: 1 as const,
      extensions: {
        "test-plugin": { entrypoint: "./plugin.mjs", failurePolicy: "skip-fact" as const },
      },
    };

    const entries = await resolvePluginEntries(config, configPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.namespace).toBe("test-plugin");
    expect(typeof entries[0]!.plugin.project).toBe("function");
  });

  it("exits with code 1 when plugin module does not export a default function", async () => {
    const pluginPath = join(tmpDir, "bad-plugin.mjs");
    await writeFile(pluginPath, "export const notDefault = 42;");

    const configPath = join(tmpDir, "config.json");
    const config = {
      version: 1 as const,
      extensions: {
        "bad-plugin": { entrypoint: "./bad-plugin.mjs", failurePolicy: "skip-fact" as const },
      },
    };

    await expect(resolvePluginEntries(config, configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when factory does not return a valid ProjectorPlugin", async () => {
    const pluginPath = join(tmpDir, "invalid-plugin.mjs");
    await writeFile(pluginPath, "export default async function factory() { return null; }");

    const configPath = join(tmpDir, "config.json");
    const config = {
      version: 1 as const,
      extensions: {
        p: { entrypoint: "./invalid-plugin.mjs", failurePolicy: "skip-fact" as const },
      },
    };

    await expect(resolvePluginEntries(config, configPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// initializePlugins — parallel init and fatal aggregation
// ---------------------------------------------------------------------------

describe("initializePlugins – parallel init and fatal aggregation", () => {
  it("returns normally when no plugins have init()", async () => {
    const entries: PluginEntry[] = [
      {
        namespace: "a",
        plugin: { project: async () => ({ type: "success", data: {} }) },
        failurePolicy: "skip-fact",
      },
    ];
    await expect(initializePlugins(entries)).resolves.toBeUndefined();
  });

  it("returns normally when all init() results are ready", async () => {
    const entries: PluginEntry[] = [
      {
        namespace: "a",
        plugin: {
          init: async (): Promise<PluginInitResult> => ({ type: "ready" }),
          project: async () => ({ type: "success", data: {} }),
        },
        failurePolicy: "skip-fact",
      },
    ];
    await expect(initializePlugins(entries)).resolves.toBeUndefined();
  });

  it("exits with code 1 when one plugin returns fatal init result", async () => {
    const entries: PluginEntry[] = [
      {
        namespace: "bad",
        plugin: {
          init: async (): Promise<PluginInitResult> => ({ type: "fatal", message: "init failed" }),
          project: async () => ({ type: "success", data: {} }),
        },
        failurePolicy: "skip-fact",
      },
    ];
    await expect(initializePlugins(entries)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("init failed"));
  });

  it("reports all failing plugins before exiting", async () => {
    const entries: PluginEntry[] = [
      {
        namespace: "a",
        plugin: {
          init: async (): Promise<PluginInitResult> => ({ type: "fatal", message: "err-a" }),
          project: async () => ({ type: "success", data: {} }),
        },
        failurePolicy: "skip-fact",
      },
      {
        namespace: "b",
        plugin: {
          init: async (): Promise<PluginInitResult> => ({ type: "fatal", message: "err-b" }),
          project: async () => ({ type: "success", data: {} }),
        },
        failurePolicy: "skip-fact",
      },
    ];
    await expect(initializePlugins(entries)).rejects.toThrow("process.exit(1)");
    const writeCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(writeCalls.some((m) => m.includes("err-a"))).toBe(true);
    expect(writeCalls.some((m) => m.includes("err-b"))).toBe(true);
  });

  it("exits with code 1 when init() throws instead of returning fatal", async () => {
    const entries: PluginEntry[] = [
      {
        namespace: "thrower",
        plugin: {
          init: async () => {
            throw new Error("boom");
          },
          project: async () => ({ type: "success", data: {} }),
        },
        failurePolicy: "skip-fact",
      },
    ];
    await expect(initializePlugins(entries)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
