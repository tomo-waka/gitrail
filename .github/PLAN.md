# gitrail — Project Build-out Plan

## Overview

8 phases total. Each phase ends with a verification checkpoint — implementation pauses for review and sign-off before moving to the next phase.

Existing dependencies in `package.json` are provisional and can be reconsidered during implementation if there is good reason.

## Tooling Decisions

| Concern       | Choice                           |
| ------------- | -------------------------------- |
| CLI framework | citty (keep as-is)               |
| Git library   | isomorphic-git (fixed by design) |
| Testing       | Vitest (ESM-native)              |
| Linting       | ESLint v9 + typescript-eslint    |
| Formatting    | oxfmt (keep as-is)               |

---

## Phase 0: Project Tooling Setup ✅ / 🔲

_Configure all developer tooling. No source code changes._

### Steps

1. **`package.json`** — add devDependencies (`eslint`, `typescript-eslint`, `vitest`) and scripts:
   - `lint`, `lint:fix`, `test`, `test:watch`
2. **`eslint.config.js`** — ESLint flat config (ESM `.js`); `tseslint.configs.recommended`; applies to `src/**/*.ts`; ignores `dist/`
3. **`vitest.config.ts`** — Node environment; test match: `tests/**/*.test.ts`
4. **`npm install`** — lock new deps

### Verification

- [ ] `npm run build` — no regressions
- [ ] `npm run lint` — passes on `src/index.ts`
- [ ] `npm test` — exits 0 ("no test files found" is acceptable)
- [ ] `npm run fmt:check` — passes (oxfmt unaffected)

---

## Phase 1: Scaffold & Shared Types 🔲

_All shared TypeScript interfaces and types. No logic._

### Steps

1. `src/git/types.ts` — `GitAdapter` interface, `RawCommit`, `GitAdapterError` + `GitAdapterErrorCode`
2. `src/core/types.ts` — `ExtractorConfig`, `RotationConfig`, `StateFile`
3. `src/output/types.ts` — `OutputCommit`

### Verification

- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm run lint` — zero ESLint errors

---

## Phase 2: Git Adapter Layer (`src/git/`) 🔲

_Concrete isomorphic-git adapter: ref resolution, remote URL, BFS commit walk with exclusion._

### Steps

1. `src/git/isomorphic-git-adapter.ts`:
   - `resolveRef()` — resolve branch name to commit hash
   - `getRemoteUrl()` — read `remote.origin.url` via isomorphic-git
   - `walkCommits()` — BFS from HEAD; `collectReachable()` pre-computation for exclusion
   - All isomorphic-git exceptions wrapped in `GitAdapterError`
2. `src/git/index.ts` — barrel export
3. Unit tests: full traversal, exclusion boundary, 2-parent merge DAG

### Verification

- [ ] `npm test` — all tests pass
- [ ] Smoke test: extract commits from a real local repo

---

## Phase 3: Output Layer (`src/output/`) 🔲

_JSONL serialization, ISO 8601 timestamp conversion, file rotation._

### Steps

1. `src/output/utils.ts` — `toISO8601()` (negated-offset algorithm), `splitMessage()`
2. `src/output/writer.ts` — `OutputWriter` class; `{prefix}-000001.jsonl`; rotate post-write on `maxLines`/`maxBytes`; LF-only
3. `src/output/index.ts` — barrel export
4. Unit tests: `toISO8601` edge cases (JST, UTC, negative offset), `splitMessage`, rotation trigger logic

### Verification

- [ ] `npm test` — all tests pass

---

## Phase 4: Core Logic Layer (`src/core/`) 🔲

_Orchestration, differential filtering, output mapping, atomic state file management._

### Steps

1. `src/core/extractor.ts` — `Extractor` class:
   - Full extraction / `--since-date` (filter + early stop) / `--since-commit` + `--state` (excludeHash)
   - Multi-branch sequential traversal with global `visited` Set (within-run dedup)
   - `RawCommit` → `OutputCommit` mapping (repository.name/url derived once per run)
   - State file: read with `path.resolve()` comparison; write atomically (`.tmp` → rename); only after all output flushed
   - Non-fatal warnings: branch missing, `lastCommitHash` gone → fall back to full
2. `src/core/index.ts` — barrel export
3. Unit tests: dedup across branches, since-date + early stop, state file round-trip, atomic write

### Verification

- [ ] `npm test` — all tests pass
- [ ] Smoke test: full extraction produces valid JSONL

---

## Phase 5: CLI Layer + End-to-End Wiring (`src/cli/`) 🔲

_Wire all layers through citty, implement all validation, complete `src/index.ts`._

### Steps

1. `src/cli/args.ts`:
   - Parse all 9 parameters
   - Enforce 3 mutual-exclusion rules
   - All validation rules from `cli.instructions.md`
   - `--output-prefix` derivation via `getRemoteUrl()` fallback chain
   - Build and return `ExtractorConfig`
2. `src/cli/index.ts` — barrel export
3. Update `src/index.ts` — replace citty stub with full CLI → `Extractor` delegation; exit codes 0/1/2
4. Integration test: full run + incremental run against a real repo

### Verification

- [ ] `node dist/index.js --help` — usage displayed correctly
- [ ] Smoke tests: full, incremental, rotation

---

## Phase 6: GitHub Actions CI/CD 🔲

_Automate quality checks on every PR; publish to npm on release tag._

### Steps

1. `.github/workflows/ci.yml`:
   - Triggers: push to `main`, `pull_request`
   - Jobs: typecheck (`tsc --noEmit`), lint, format-check, test, build
   - Node 22
2. `.github/workflows/release.yml`:
   - Trigger: push of `v*` tag
   - Jobs: build → `npm publish` (uses `NODE_AUTH_TOKEN` secret)

### Verification

- [ ] Test PR: all CI jobs pass on GitHub

---

## Phase 7: OSS Documentation 🔲

_Minimum viable documentation for a public CLI project._

### Steps

1. `README.md` — description, install, quick-start, full CLI reference, output schema overview, incremental extraction example
2. `CONTRIBUTING.md` — local build, run tests, submit PRs
3. `CHANGELOG.md` — initial v0.1.0 entry (or GitHub Releases only — decide at writing time)
4. `.github/ISSUE_TEMPLATE/` (optional) — bug report, feature request templates
5. Verify `LICENSE` is correct (already present)

### Verification

- [ ] README renders correctly on GitHub
- [ ] All command examples match actual CLI output

---

## Final End-to-End Checklist

- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm run lint` — zero ESLint warnings/errors
- [ ] `npm test` — all unit tests pass
- [ ] `node dist/index.js --branch main ./` — full extraction; produces `gitrail-000001.jsonl`
- [ ] Re-run with `--state state.json` — no new output; state file updated
- [ ] New commit → re-run with `--state` — only new commit in output
- [ ] `--rotate-lines 2` — produces `gitrail-000001.jsonl`, `gitrail-000002.jsonl`, …
- [ ] CI workflow passes on GitHub PR
