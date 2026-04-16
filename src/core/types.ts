export interface PersonIdentity {
  name: string;
  email: string;
}

export interface RotationConfig {
  maxLines?: number;
  maxBytes?: number;
}

export type ExtractionRange = { type: "ref"; ref: string } | { type: "date"; since: Date };

export interface ExtractorConfig {
  repositoryPath: string;
  branches: string[];
  outputDir: string;
  outputPrefix: string;
  rotation: RotationConfig;
  mode: "snapshot" | "incremental";
  onMissingState?: "error" | "snapshot";
  range?: ExtractionRange;
  stateFilePath?: string;
}

export interface Reporter {
  warn(message: string): void;
  progress(commitsWritten: number): void;
  done(commitsWritten: number): void;
}

export interface StateStore {
  read(): Promise<StateFile | null>;
  write(state: StateFile): Promise<void>;
}

export type WallClock = () => Date;
export type MonotonicClock = () => number;

export interface StateBranchEntry {
  name: string;
  lastCommitHash: string;
}

export interface StateFile {
  version: 1;
  generatedAt: string;
  repositoryPath: string;
  branches: StateBranchEntry[];
}

export interface ExtractionResult {
  commitsWritten: number;
  filesCreated: number;
  bytesWritten: number;
  elapsedMs: number;
  branches: string[];
}
