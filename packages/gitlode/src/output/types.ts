import type { PersonIdentity } from "../core/index.js";
import { FactType } from "../core/types.js";

export interface OutputRecordExtensions {
  [namespace: string]: Record<string, unknown> | null;
}

export interface OutputPerson extends PersonIdentity {
  readonly timestamp: string; // ISO 8601 with commit's own timezone offset
}

export interface OutputRepository {
  readonly name: string;
  readonly url: string | null;
}

export interface OutputCommit {
  readonly oid: string;
  readonly subject: string;
  readonly body: string;
  readonly author: OutputPerson;
  readonly committer: OutputPerson;
  readonly parents: readonly string[];
  readonly repository: OutputRepository;
  readonly extensions?: OutputRecordExtensions;
}

export interface OutputFileRecord extends OutputCommit {
  readonly file: {
    readonly path: string;
    readonly status: "added" | "modified" | "deleted";
    readonly additions: number | null;
    readonly deletions: number | null;
  };
}

type OutputRecordMap = {
  commit: OutputCommit;
  "file-change": OutputFileRecord;
};

export type OutputRecordFor<Type extends FactType> = OutputRecordMap[Type];

export type OutputRecord = OutputRecordFor<FactType>;
