### Phase 1: npm Workspaces Monorepo Migration

_This phase migrates the repository to npm workspaces while preserving core package continuity (`gitlode`) and avoiding intentional CLI/output contract changes._

#### Design Maturity

- [x] Implementation-ready
- [ ] Deferred design

#### Design References

- `.github/roadmap.md` — "Repository/Build: npm-workspaces monorepo migration for core package continuity"
- `.github/instructions/development-workflow.instructions.md` — Stage 1e planning-branch requirements and phase-to-plan consistency expectations
- `.github/instructions/phase-template.instructions.md` — Implementation-ready phase completeness criteria
- `.github/copilot-instructions.md` — Project-level constraints (core package continuity, no contract drift)

#### Design Decisions

- **Preferred API / library / Node.js built-in**: Use npm workspaces only (no additional monorepo toolchain in this phase).
- **Owning layer**: Repository/build layout ownership is at workspace root; runtime behavior ownership remains in the core package.
- **Workspace/package topology**:
  - Root becomes an orchestrator workspace with `private: true`, shared scripts, and shared dev dependencies.
  - `packages/gitlode` is the only published package in this phase and contains the current runtime source (`src/`), tests, and package-local build output (`dist/`).
  - Reserve `packages/*` as the stable package boundary for future official plugin packages without introducing them in this phase.
- **Package naming and publication continuity strategy**:
  - Keep package name as `gitlode` and preserve CLI bin command as `gitlode`.
  - Preserve executable entry semantics (`dist/index.js`) and package `type`/`engines` constraints unless technically required for relocation.
  - Root package is not publishable; publish target is only `packages/gitlode`.
- **Build/test/lint/format script ownership split**:
  - Root scripts are orchestration entrypoints for CI and local development (`build`, `test`, `lint`, `format:check`, `format:write`).
  - `packages/gitlode` owns the concrete command implementations (TypeScript compile, Vitest invocation, lint, format), so package behavior can be validated in isolation.
  - Root orchestration must call the package script through workspace-aware npm commands and remain safe when additional packages are added later.
- **TypeScript configuration strategy**:
  - Introduce root shared base config (`tsconfig.base.json`) for common strict/compiler policy.
  - `packages/gitlode/tsconfig.json` extends the base and owns package-local path settings (`rootDir`, `outDir`, `include`).
  - Do not introduce project references in this phase; single-package migration keeps build flow simple while leaving room for later adoption.
- **CI/workflow impact and path assumptions**:
  - CI and release workflows must remain root-invoked and workspace-aware; no step may assume runtime files remain under root-level `src/` or `dist/`.
  - Dependency install remains `npm ci` at repository root.
  - Publish step targets only the `gitlode` workspace package and must not accidentally publish root or future internal packages.
- **Compatibility constraints (must hold after migration)**:
  - No intentional CLI option, argument parsing, output schema, or stream-behavior change.
  - Core install/execute contract remains `npx gitlode` / global `gitlode` command.
  - Existing extraction semantics (`--state`, traversal behavior, profile output shape) remain unchanged.
- **New runtime dependencies**: None.
- **Edge case behavior (migration-specific)**:
  - Supported package manager for this phase is npm with workspace support; no requirement to support pnpm/yarn command parity.
  - Root bootstrap (`npm ci`) must install and link workspace dependencies without requiring per-package install commands.
  - Root-level development commands must still work for developers who do not `cd` into package directories.
  - Package-local commands in `packages/gitlode` must also work for focused debugging.
- **Any other non-obvious decision that was consciously made**:
  - No intentional code-level refactor in runtime modules during relocation; move-first strategy reduces behavioral regression risk.
  - Any incidental path/import adjustments required by relocation are allowed only if behavior remains equivalent.

#### Non-Goals

- Plugin system design and plugin package policy work
- Adding new official plugin packages
- Runtime architecture changes unrelated to monorepo/workspace migration
- CLI UX, output schema, or extraction algorithm enhancements
- Replacing npm scripts with alternative task runners (for example turbo/nx) in this phase

#### Target Files

| File                             | Action        | Notes                                                                                         |
| -------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `package.json`                   | Modify        | Convert root to private workspace orchestrator and define workspace-aware root scripts        |
| `tsconfig.base.json`             | Create        | Shared strict TypeScript defaults for workspace packages                                      |
| `tsconfig.json`                  | Modify        | Root-level role becomes coordination/reference surface (no package-local rootDir assumptions) |
| `packages/gitlode/package.json`  | Create        | Core published package manifest preserving name/bin continuity                                |
| `packages/gitlode/tsconfig.json` | Create        | Package-local compiler config extending root base                                             |
| `packages/gitlode/src/**`        | Move/Verify   | Relocate existing source without intentional behavior changes                                 |
| `packages/gitlode/test/**`       | Move/Verify   | Relocate tests and preserve current behavioral coverage intent                                |
| `.github/workflows/ci.yml`       | Modify        | Ensure CI invokes root workspace scripts compatible with package relocation                   |
| `.github/workflows/release.yml`  | Modify        | Publish only the `gitlode` workspace package from monorepo layout                             |
| `README.md`                      | Modify        | Update development/build/test commands and repository layout examples                         |
| `docs/usage.md`                  | Review/Modify | Confirm installation and execution guidance remains accurate with workspace layout            |
| `docs/design/architecture.md`    | Review/Modify | Update repository/layout references that become stale after package relocation                |

#### Documentation Touchpoints

| File                              | Section                                                                           | Action |
| --------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `README.md`                       | "Project structure", "Development", "Build/Test" (or equivalent command sections) | Update |
| `docs/usage.md`                   | Setup and local execution sections that assume single-package root layout         | Update |
| `docs/design/architecture.md`     | Repository/component layout references                                            | Update |
| `.github/copilot-instructions.md` | "Repository Structure" block                                                      | Update |
| `CHANGELOG.md`                    | `[0.6.2]` migration notes                                                         | Update |

#### Implementation Notes

- Relocate package files before workflow/script rewiring so broken path assumptions are visible early.
- Keep command surface stable at root (`npm run build`, `npm test`, and formatting/lint commands) to avoid CI and contributor workflow drift.
- Validate that `npm pack --workspace gitlode --dry-run` includes the expected built artifacts and excludes workspace-only files.

#### Verification

**Automated:**

```text
npm run build
npm test
npm run lint
npm run format:check
```

**Behavioral checks** (manual CLI invocations or observable output changes):

- Run pre-migration and post-migration CLI smoke commands with the same sample repository and confirm equivalent observable behavior (success/failure expectations and output contract shape).
- Validate `npx gitlode --help` and packaged command execution from workspace build output remain functional.
- Confirm release workflow publish path resolves to `packages/gitlode` artifact and not the root workspace.
