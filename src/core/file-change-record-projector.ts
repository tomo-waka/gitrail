import { splitMessage, toISO8601 } from "../output/index.js";
import type { OutputFileRecord } from "../output/index.js";
import type { FileChangeFact } from "./types.js";

export interface FileChangeRecordProjector {
  project(fileChanges: AsyncIterable<FileChangeFact>): AsyncIterable<OutputFileRecord>;
}

export class DefaultFileChangeRecordProjector implements FileChangeRecordProjector {
  private readonly repoName: string;
  private readonly remoteUrl: string | null;

  constructor(repoName: string, remoteUrl: string | null) {
    this.repoName = repoName;
    this.remoteUrl = remoteUrl;
  }

  async *project(fileChanges: AsyncIterable<FileChangeFact>): AsyncIterable<OutputFileRecord> {
    for await (const fact of fileChanges) {
      const { subject, body } = splitMessage(fact.commit.message);
      yield {
        oid: fact.commit.oid,
        subject,
        body,
        author: {
          name: fact.commit.author.name,
          email: fact.commit.author.email,
          timestamp: toISO8601(fact.commit.author.timestamp, fact.commit.author.timezoneOffset),
        },
        committer: {
          name: fact.commit.committer.name,
          email: fact.commit.committer.email,
          timestamp: toISO8601(
            fact.commit.committer.timestamp,
            fact.commit.committer.timezoneOffset,
          ),
        },
        parents: fact.commit.parents,
        repository: { name: this.repoName, url: this.remoteUrl },
        file: fact.file,
      };
    }
  }
}
