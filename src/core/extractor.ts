import { basename, resolve } from "node:path";

import type { GitAdapter } from "../git/index.js";
import { OutputWriter, formatSessionTimestamp } from "../output/index.js";
import { DefaultBranchTraversalPlanner } from "./branch-traversal-planner.js";
import { DefaultCommitRecordProjector } from "./commit-record-projector.js";
import { DefaultCommitTraversalExtractor } from "./commit-traversal-extractor.js";
import { DefaultFileChangeExpander } from "./file-change-expander.js";
import { DefaultFileChangeRecordProjector } from "./file-change-record-projector.js";
import type {
  BranchCheckpoint,
  BranchTraversalPlan,
  CheckpointStore,
  CommitHash,
  ExtractionCheckpoint,
  ExtractionResult,
  ExtractorConfig,
  MonotonicClock,
  Reporter,
  WallClock,
} from "./types.js";
import { isCommitHash } from "./types.js";

function deriveRepoName(remoteUrl: string | null, repoPath: string): string {
  if (remoteUrl) {
    const lastSegment = remoteUrl.split("/").pop() ?? "";
    const stripped = lastSegment.replace(/\.git$/, "");
    return stripped || basename(repoPath);
  }
  return basename(repoPath);
}

export class Extractor {
  private readonly config: ExtractorConfig;
  private readonly adapter: GitAdapter;
  private readonly reporter: Reporter;
  private readonly wallNow: WallClock;
  private readonly monotonicNow: MonotonicClock;
  private readonly stateStore?: CheckpointStore;
  constructor(
    config: ExtractorConfig,
    adapter: GitAdapter,
    reporter: Reporter,
    wallNow: WallClock,
    monotonicNow: MonotonicClock,
    stateStore?: CheckpointStore,
  ) {
    this.config = config;
    this.adapter = adapter;
    this.reporter = reporter;
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
    this.stateStore = stateStore;
  }

  // --- Checkpoint helpers ---

  private async initializeStateMap(repoPath: string): Promise<Map<string, CommitHash>> {
    const stateMap = new Map<string, CommitHash>();
    if (this.stateStore && this.config.mode === "incremental") {
      const checkpoint = await this.stateStore.read();
      if (checkpoint === null) {
        if (this.config.onMissingState === "snapshot") {
          this.reporter.warn(
            `Warning: State file not found: ${this.config.stateFilePath}. Falling back to full snapshot extraction.`,
          );
          // stateMap stays empty → full traversal
        }
      } else {
        if (checkpoint.version !== 1) {
          throw new Error(`Unsupported state file version: ${checkpoint.version}`);
        }
        const recordedPath = resolve(checkpoint.repositoryPath);
        if (recordedPath !== repoPath) {
          throw new Error(
            `State file was created for a different repository: ${checkpoint.repositoryPath}`,
          );
        }
        for (const entry of checkpoint.branches) {
          if (!isCommitHash(entry.lastCommitHash)) {
            throw new Error(
              `Invalid commit hash in state file for branch "${entry.name}": ${entry.lastCommitHash}`,
            );
          }
          stateMap.set(entry.name, entry.lastCommitHash);
        }
      }
    }
    return stateMap;
  }

  private buildCandidateCheckpoint(
    repositoryPath: string,
    generatedAt: string,
    plans: readonly BranchTraversalPlan[],
  ): ExtractionCheckpoint {
    return {
      version: 1,
      generatedAt,
      repositoryPath,
      branches: plans.map(
        (plan): BranchCheckpoint => ({ name: plan.name, lastCommitHash: plan.head }),
      ),
    };
  }

  async run(): Promise<ExtractionResult> {
    const startTime = this.monotonicNow();
    const repoPath = resolve(this.config.repositoryPath);

    const remoteUrl = await this.adapter.getRemoteUrl(repoPath);
    const repoName = deriveRepoName(remoteUrl, repoPath);

    const stateMap = await this.initializeStateMap(repoPath);

    const sessionTs = this.wallNow();
    const tsStr = formatSessionTimestamp(sessionTs);
    const writer = new OutputWriter(
      this.config.outputDir,
      (seq) => `${this.config.outputPrefix}-${tsStr}-${String(seq).padStart(6, "0")}.jsonl`,
      this.config.rotation,
    );

    const planner = new DefaultBranchTraversalPlanner(this.adapter);
    const traverser = new DefaultCommitTraversalExtractor(this.adapter);
    const expander = new DefaultFileChangeExpander(this.adapter);
    const commitProjector = new DefaultCommitRecordProjector(repoName, remoteUrl);
    const fileProjector = new DefaultFileChangeRecordProjector(repoName, remoteUrl);
    const recordsRef = { count: 0 };
    const generatedAt = sessionTs.toISOString();
    let candidateCheckpoint = this.buildCandidateCheckpoint(repoPath, generatedAt, []);

    try {
      const plans = await planner.plan(
        {
          repositoryPath: repoPath,
          branches: [...this.config.branches],
          mode: this.config.mode,
          priorBranchMap: stateMap,
          range: this.config.range,
        },
        this.reporter,
      );
      candidateCheckpoint = this.buildCandidateCheckpoint(repoPath, generatedAt, plans);

      const commitFacts = traverser.extract(
        {
          repositoryPath: repoPath,
          repoName,
          remoteUrl,
          plans,
          range: this.config.range,
        },
        this.reporter,
      );

      const recordStream =
        this.config.outputMode === "file"
          ? fileProjector.project(expander.expand(commitFacts, repoPath))
          : commitProjector.project(commitFacts);

      for await (const record of recordStream) {
        await writer.write(record);
        recordsRef.count++;
        this.reporter.progress(recordsRef.count);
      }
    } finally {
      this.reporter.done(recordsRef.count);
      await writer.close();
    }

    // Write checkpoint atomically — only reached on success (no exception)
    if (this.stateStore && candidateCheckpoint.branches.length > 0) {
      await this.stateStore.write(candidateCheckpoint);
    }

    return {
      recordsWritten: recordsRef.count,
      filesCreated: writer.filesCreated,
      bytesWritten: writer.bytesWritten,
      elapsedMs: this.monotonicNow() - startTime,
      branches: candidateCheckpoint.branches.map((b) => b.name),
    };
  }
}
