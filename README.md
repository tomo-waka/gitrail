# gitrail

A CLI tool that extracts Git repository commit history and outputs it as [JSON Lines](https://jsonlines.org/) (`.jsonl`) files, suitable for ingestion into data warehouses and analytical systems.

## Features

- Reads Git repository data via [isomorphic-git](https://isomorphic-git.org/) — no system-installed Git required
- Outputs one commit per line in JSON Lines format
- Supports incremental (differential) extraction via a state file
- Handles multi-branch extraction with cross-branch deduplication

## Installation

```bash
npm install -g gitrail
```

## Usage

```bash
# Full extraction of the main branch
gitrail --branch main ./my-repo

# Multiple branches, custom output directory
gitrail --branch main --branch develop --output-dir ./output ./my-repo

# Incremental extraction using a state file
gitrail --branch main --state ./gitrail-state.json ./my-repo

# Differential extraction from a specific commit
gitrail --branch main --since-commit abc123def456 ./my-repo

# With file rotation (new file every 10,000 lines or 100 MB)
gitrail --branch main --rotate-lines 10000 --rotate-size 104857600 ./my-repo
```

## Output Format

Each line is a JSON object representing one commit:

```json
{
  "oid": "a1b2c3d4...",
  "subject": "Fix null pointer in auth module",
  "body": "",
  "author": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "timestamp": "2024-01-15T09:00:00+09:00"
  },
  "committer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "timestamp": "2024-01-15T09:05:00+09:00"
  },
  "parents": ["parenthash1"],
  "repository": { "name": "my-repo", "url": "https://github.com/org/my-repo" }
}
```

## License

MIT
