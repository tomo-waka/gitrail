import { basename, resolve } from "node:path";

import type { FileChange, GitAdapter, RawCommit } from "../git/index.js";
import { GitAdapterError } from "../git/index.js";
import { OutputWriter, formatSessionTimestamp, splitMessage, toISO8601 } from "../output/index.js";
import type { OutputCommit, OutputFileRecord } from "../output/index.js";
import type {
  BranchCheckpoint,
  CheckpointStore,
  CommitFact,
  CommitHash,
  ExtractionCheckpoint,
  ExtractionResult,
  ExtractorConfig,
  FileChangeFact,
  MonotonicClock,
  Reporter,
  WallClock,
} from "./types.js";
import { assertNever, isCommitHash } from "./types.js";

function deriveRepoName(remoteUrl: string | null, repoPath: string): string {
  if (remoteUrl) {
    const lastSegment = remoteUrl.split("/").pop() ?? "";
    const stripped = lastSegment.replace(/\.git$/, "");
    return stripped || basename(repoPath);
  }
  return basename(repoPath);
}

interface BranchRunContext {
  readonly repoPath: string;
  readonly repoName: string;
  readonly remoteUrl: string | null;
  readonly stateMap: ReadonlyMap<string, CommitHash>;
  readonly newBranchExclude: CommitHash | undefined;
  readonly writer: OutputWriter;
  readonly visited: Set<string>;
  readonly recordsRef: { count: number };
  readonly branchHeads: Map<string, CommitHash>;
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

  // --- Fact creation helpers (anticipate future CommitTraversalExtractor split) ---

  private toCommitFact(commit: RawCommit, repoName: string, remoteUrl: string | null): CommitFact {
    return {
      oid: commit.oid,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.author.timestamp,
        timezoneOffset: commit.author.timezoneOffset,
      },
      committer: {
        name: commit.committer.name,
        email: commit.committer.email,
        timestamp: commit.committer.timestamp,
        timezoneOffset: commit.committer.timezoneOffset,
      },
      parents: commit.parents,
      repository: { name: repoName, url: remoteUrl },
    };
  }

  private toFileChangeFact(fact: CommitFact, fileChange: FileChange): FileChangeFact {
    return {
      commit: fact,
      file: {
        path: fileChange.path,
        status: fileChange.status,
        additions: fileChange.additions,
        deletions: fileChange.deletions,
      },
    };
  }

  // --- Projection helpers (anticipate future CommitRecordProjector / FileChangeRecordProjector split) ---

  private projectCommitFact(fact: CommitFact): OutputCommit {
    const { subject, body } = splitMessage(fact.message);
    return {
      oid: fact.oid,
      subject,
      body,
      author: {
        name: fact.author.name,
        email: fact.author.email,
        timestamp: toISO8601(fact.author.timestamp, fact.author.timezoneOffset),
      },
      committer: {
        name: fact.committer.name,
        email: fact.committer.email,
        timestamp: toISO8601(fact.committer.timestamp, fact.committer.timezoneOffset),
      },
      parents: fact.parents,
      repository: { name: fact.repository.name, url: fact.repository.url },
    };
  }

  private projectFileChangeFact(fact: FileChangeFact): OutputFileRecord {
    return {
      ...this.projectCommitFact(fact.commit),
      file: {
        path: fact.file.path,
        status: fact.file.status,
        additions: fact.file.additions,
        deletions: fact.file.deletions,
      },
    };
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

  private async computeNewBranchExclude(
    newBranches: ReadonlySet<string>,
    stateMap: ReadonlyMap<string, CommitHash>,
    repoPath: string,
  ): Promise<CommitHash | undefined> {
    if (newBranches.size === 0 || stateMap.size === 0) {
      return undefined;
    }
    const mergeBase = await this.adapter.findMergeBase(repoPath, Array.from(stateMap.values()));
    return mergeBase ?? undefined;
  }

  private resolveExcludeHash(
    branch: string,
    stateMap: ReadonlyMap<string, CommitHash>,
    newBranchExclude: CommitHash | undefined,
  ): CommitHash | undefined {
    if (this.config.range === undefined) {
      return stateMap.get(branch) ?? newBranchExclude;
    }
    const range = this.config.range;
    if (range.type === "ref") {
      return range.ref;
    } else if (range.type === "date") {
      return undefined;
    } else {
      assertNever(range);
    }
  }

  private async processBranch(branch: string, ctx: BranchRunContext): Promise<void> {
    let head: CommitHash;
    try {
      head = await this.adapter.resolveRef(ctx.repoPath, branch);
    } catch (err) {
      if (err instanceof GitAdapterError && err.code === "REF_NOT_FOUND") {
        this.reporter.warn(
          `Warning: Branch "${branch}" no longer exists in the repository. Skipping.`,
        );
        return;
      }
      throw err;
    }
    ctx.branchHeads.set(branch, head);

    const excludeHash = this.resolveExcludeHash(branch, ctx.stateMap, ctx.newBranchExclude);

    const writeCommit = async (commit: RawCommit) => {
      if (ctx.visited.has(commit.oid)) return;
      ctx.visited.add(commit.oid);
      if (this.config.range?.type === "date") {
        if (commit.committer.timestamp * 1000 <= this.config.range.since.getTime()) {
          return;
        }
      }
      const fact = this.toCommitFact(commit, ctx.repoName, ctx.remoteUrl);
      if (this.config.outputMode === "commit") {
        await ctx.writer.write(this.projectCommitFact(fact));
        ctx.recordsRef.count++;
        this.reporter.progress(ctx.recordsRef.count);
      } else {
        const parentOid = commit.parents[0] as CommitHash | undefined;
        const fileChanges = await this.adapter.getFileChanges(ctx.repoPath, commit.oid, parentOid);
        for (const fileChange of fileChanges) {
          await ctx.writer.write(
            this.projectFileChangeFact(this.toFileChangeFact(fact, fileChange)),
          );
          ctx.recordsRef.count++;
          this.reporter.progress(ctx.recordsRef.count);
        }
      }
    };

    try {
      for await (const commit of this.adapter.walkCommits(ctx.repoPath, head, excludeHash)) {
        await writeCommit(commit);
      }
    } catch (err) {
      if (err instanceof GitAdapterError && err.code === "COMMIT_NOT_FOUND") {
        this.reporter.warn(
          `Warning: Last commit hash for branch "${branch}" no longer exists. Falling back to full extraction.`,
        );
        for await (const commit of this.adapter.walkCommits(ctx.repoPath, head)) {
          await writeCommit(commit);
        }
      } else {
        throw err;
      }
    }
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

    // Identify new branches (present in config but absent from stateMap) for deduplication
    const newBranches = new Set(
      this.config.mode === "incremental"
        ? this.config.branches.filter((b) => !stateMap.has(b))
        : [],
    );

    const branchHeads = new Map<string, CommitHash>();
    const visited = new Set<string>();
    const recordsRef = { count: 0 };

    try {
      // In incremental mode, compute merge base of existing branches to use as
      // excludeHash for newly added branches, preventing cross-run duplicates
      const newBranchExcludeHash = await this.computeNewBranchExclude(
        newBranches,
        stateMap,
        repoPath,
      );

      const ctx: BranchRunContext = {
        repoPath,
        repoName,
        remoteUrl,
        stateMap,
        newBranchExclude: newBranchExcludeHash,
        writer,
        visited,
        recordsRef,
        branchHeads,
      };

      for (const branch of this.config.branches) {
        await this.processBranch(branch, ctx);
      }
    } finally {
      this.reporter.done(recordsRef.count);
      await writer.close();
    }

    // Write checkpoint atomically — only reached on success (no exception)
    if (this.stateStore && branchHeads.size > 0) {
      const newCheckpoint: ExtractionCheckpoint = {
        version: 1,
        generatedAt: sessionTs.toISOString(),
        repositoryPath: repoPath,
        branches: Array.from(branchHeads.entries()).map(
          ([name, lastCommitHash]): BranchCheckpoint => ({ name, lastCommitHash }),
        ),
      };
      await this.stateStore.write(newCheckpoint);
    }

    return {
      recordsWritten: recordsRef.count,
      filesCreated: writer.filesCreated,
      bytesWritten: writer.bytesWritten,
      elapsedMs: this.monotonicNow() - startTime,
      branches: Array.from(branchHeads.keys()),
    };
  }
}
