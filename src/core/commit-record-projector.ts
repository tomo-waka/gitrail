import { splitMessage, toISO8601 } from "../output/index.js";
import type { OutputCommit } from "../output/index.js";
import type { CommitFact } from "./types.js";

export interface CommitRecordProjector {
  project(commits: AsyncIterable<CommitFact>): AsyncIterable<OutputCommit>;
}

export class DefaultCommitRecordProjector implements CommitRecordProjector {
  private readonly repoName: string;
  private readonly remoteUrl: string | null;

  constructor(repoName: string, remoteUrl: string | null) {
    this.repoName = repoName;
    this.remoteUrl = remoteUrl;
  }

  async *project(commits: AsyncIterable<CommitFact>): AsyncIterable<OutputCommit> {
    for await (const fact of commits) {
      const { subject, body } = splitMessage(fact.message);
      yield {
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
        repository: { name: this.repoName, url: this.remoteUrl },
      };
    }
  }
}
