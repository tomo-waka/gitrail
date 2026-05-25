import type { OutputRecord, OutputRecordFor } from "../output/types.js";
import type { OutputRecordExtensions } from "../output/types.js";
import { projectCommit, projectFileChange } from "./fact-projector.js";
import type {
  Fact,
  FactFor,
  FactProjector,
  FactType,
  PluginEntry,
  ProgressReporter,
  ProjectionContext,
} from "./types.js";
import { assertNever } from "./types.js";

export class EnrichingFactProjector implements FactProjector {
  private readonly pluginEntries: readonly PluginEntry[];
  private readonly reporter: ProgressReporter;
  private readonly repoName: string;
  private readonly remoteUrl: string | null;

  constructor(
    pluginEntries: readonly PluginEntry[],
    reporter: ProgressReporter,
    repoName: string,
    remoteUrl: string | null,
  ) {
    this.pluginEntries = pluginEntries;
    this.reporter = reporter;
    this.repoName = repoName;
    this.remoteUrl = remoteUrl;
  }

  async *project(facts: AsyncIterable<Fact>): AsyncIterable<OutputRecord> {
    for await (const fact of facts) {
      yield await this.projectOneFact(fact);
    }
  }

  private buildBaseRecord<Type extends FactType>(fact: FactFor<Type>): OutputRecordFor<Type> {
    switch (fact.type) {
      case "commit":
        return projectCommit(fact, this.repoName, this.remoteUrl) as OutputRecordFor<Type>;
      case "file-change":
        return projectFileChange(fact, this.repoName, this.remoteUrl) as OutputRecordFor<Type>;
      default:
        assertNever(fact);
    }
  }

  private factId(fact: Fact): string {
    switch (fact.type) {
      case "commit":
        return fact.oid;
      case "file-change":
        return `${fact.commit.oid}/${fact.file.path}`;
      default:
        assertNever(fact);
    }
  }

  private async projectOneFact(fact: Fact): Promise<OutputRecord> {
    const baseRecord = Object.freeze(this.buildBaseRecord(fact));
    // The discriminated union invariant (CommitFact↔OutputCommit, FileChangeFact↔OutputFileRecord)
    // is structurally guaranteed by buildBaseRecord's dispatch on fact.type. TypeScript cannot
    // verify this automatically across the union boundary, so we use a cast here.
    const ctx = { fact, baseRecord } as ProjectionContext;
    const extensions: OutputRecordExtensions = {};

    for (const entry of this.pluginEntries) {
      const { namespace, plugin, failurePolicy, profiler } = entry;
      let result;

      try {
        if (profiler) {
          profiler.resume();
          try {
            result = await plugin.project(ctx, profiler);
          } finally {
            profiler.stop();
          }
        } else {
          result = await plugin.project(ctx);
        }
      } catch (err) {
        result = {
          type: "fatal" as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      switch (result.type) {
        case "success":
          extensions[namespace] = result.data;
          break;
        case "skip":
          extensions[namespace] = null;
          this.reporter.emit({
            type: "warning",
            message: `Plugin "${namespace}" skipped fact ${this.factId(fact)}: ${result.message}`,
          });
          break;
        case "fatal":
          if (failurePolicy === "fatal") {
            throw new Error(
              `Plugin "${namespace}" fatal error on fact ${this.factId(fact)}: ${result.message}`,
            );
          }
          extensions[namespace] = null;
          this.reporter.emit({
            type: "warning",
            message: `Plugin "${namespace}" skipped fact ${this.factId(fact)}: ${result.message}`,
          });
          break;
      }
    }

    return { ...baseRecord, extensions };
  }
}
