### Phase 7: Progress Reporting Redesign and Obsolete-Path Cleanup

_Redesign the human-facing stderr contract around stable execution stages, enrich the default
successful-run summary with context that explains zero-record runs, and remove the remaining
migration-only compatibility paths so the runtime edge talks directly to the finalized
coordinator pipeline._

#### Status

- [x] Planned
- [ ] In progress
- [ ] Completed

#### Design Maturity

- [ ] Implementation-ready
- [x] Deferred design

#### Design References

- [`../instructions/architecture.instructions.md`](../instructions/architecture.instructions.md) —
  Phase 4 coordinator ownership, Phase 6 profiling, and the Phase 7 final-target contract updated
  during this planning session
- [`../instructions/cli.instructions.md`](../instructions/cli.instructions.md) — stderr progress,
  summary, `--quiet`, and `--profile` contracts updated during this planning session
- [`../roadmap.md`](../roadmap.md) — "CLI UX: Progress metrics quality and
  progress-display redesign" and the architecture migration target
- [`phase-4.md`](phase-4.md) — coordinator/sink ownership boundaries and the deferred progress
  redesign scope
- [`phase-5.md`](phase-5.md) — CLI parameter redesign and the deferred checkpoint-vocabulary
  compatibility cleanup
- [`phase-6.md`](phase-6.md) — profiling buckets that Phase 7 must keep distinct from the default
  summary

#### Design Decisions

- **Primary UX goals**: Phase 7 defines progress output first as a human-facing UX contract, not
  as an incidental projection of internal counters. The progress display must satisfy five goals:
  show liveness even when quantitative counters are temporarily unchanged, orient the user to the
  current stage, avoid pretending to know percentages or ETAs that the tool cannot justify,
  respect a low-noise stderr budget, and remain suppressible via `--quiet` for scripted use.
- **Owning layer**: human-facing progress rendering remains a CLI/runtime-edge responsibility, but
  the Core no longer reports progress as a single scalar record count. Phase 7 replaces the old
  `Reporter.progress(recordsWritten)` / `Reporter.done(recordsWritten)` contract with a structured,
  phase-aware progress reporter so implementation does not make up display semantics ad hoc.
- **Stable stderr stage model**: successful non-quiet runs use three stable stage lines only:
  `Preparing extraction`, `Extracting history`, and `Finalizing output`. Completed stage lines stay
  visible in stderr history. Only the currently active stage line may update in place.
- **Heartbeat requirement**: every active stage must emit a liveness signal even when no semantic
  counter changed recently. Phase 7 fixes the preferred liveness signal as `spinner + elapsed`,
  with a silence budget of at most `1s` between visible updates while a stage is actively running.
  This rule applies equally to `Preparing extraction`, `Extracting history`, and
  `Finalizing output`.
- **Preparation-stage semantics**: `Preparing extraction` covers repository validation, branch/ref
  resolution, output-prefix derivation, and checkpoint read/validation when applicable. While it is
  active, its stage line must update using the stage spinner and elapsed time even when no
  quantitative counters exist yet.
- **Main execution-stage semantics**: the primary semantic stage is `Extracting history`, not separate
  `Traversing history` and `Writing output` stages. Traversal, expansion, projection, and sink
  writes overlap in the streaming pipeline, so splitting them into separate user-facing stages would
- describe the implementation misleadingly. The active line renders both liveness and the best
  available cumulative progress so far.
- **Live extraction metrics**: the `Extracting history` line includes exactly these fields, in this
  order after the spinner and stage label: branch position (`branch <current>/<total>`), `commits
traversed`, `records written`, humanized `bytes written`, and `elapsed`. It does not include
  current branch names, files created, ETA, per-stage timings, or percentage estimates.
- **Semantic updates vs heartbeat updates**: semantic updates are changes to branch position,
  traversed commits, written records, or written bytes. Heartbeat updates are spinner-frame and
  elapsed-time refreshes that show the process is still alive even when semantic counters are
  unchanged. The phase contract requires both concepts; semantic updates do not replace heartbeat
  updates.
- **Update cadence**: the active stage line updates at most once per second during steady-state
  work, plus immediate updates on stage transitions, warning recovery redraws, semantic progress
  changes, and final completion. Progress remains monotonic and only advances after successful Core
  work has actually completed.
- **Finalization-stage semantics**: `Finalizing output` covers sink close and checkpoint commit. It
  must emit the same heartbeat contract (`spinner + elapsed`, `<= 1s` silence budget) while the
  stage is active, even though it does not expose semantic counters.
- **Successful-run summary**: after the stage lines complete, the CLI prints the normal aligned
  summary block to stderr. Phase 7 fixes the default summary field order as: `Records written`,
  `Commits traversed`, `Files created`, `Bytes written`, `Elapsed time`, `Branches`. `Bytes
written` uses humanized units. `Commits traversed` is required specifically so zero-record runs
  still explain that real work occurred.
- **`--profile` ordering**: when `--profile` is requested and `--quiet` is not set, the aligned
  timing block is emitted after the default completion summary, separated by a single blank line.
  The summary remains the primary outcome report; profiling remains secondary diagnostic output.
- **`--quiet` and warnings**: `--quiet` suppresses the stage lines, the default completion summary,
  and the `--profile` block. It does not suppress warnings or errors, including meaningful
  extraction warnings such as incremental missing-state fallback notices.
- **Progress event contract**: Phase 7 introduces a phase-aware progress contract in Core with the
  stable phase names `preparing`, `extracting`, and `finalizing`. The extracting snapshot must be
  able to carry `branchIndex`, `branchCount`, `commitsTraversed`, `recordsWritten`,
  `bytesWritten`, and `elapsedMs`. All active-stage snapshots must support spinner/heartbeat
  redraws. Preparing/finalizing events do not stream semantic counters, but they do carry elapsed
  time and liveness updates.
- **Terminal interaction rules**: warnings and errors must remain readable. If a warning interrupts
  an in-place progress line, the CLI prints the warning on its own line and then redraws the active
  stage line so the liveness contract continues.
- **Feasibility boundary**: Phase 7 fixes the UX target first. Technical feasibility, including the
  possibility that a long synchronous operation blocks timer-driven spinner refreshes, is a
  subsequent implementation consideration. Any implementation compromise must be evaluated against
  this UX target rather than silently redefining the target around current constraints.
- **Metric ownership**: `commitsTraversed` is counted at the coordinator-owned pipeline boundary by
  wrapping the `CommitFact` stream before it reaches the projector or expander. `recordsWritten`
  and `bytesWritten` continue to advance only after successful `OutputSink.write()` calls.
- **Migration cleanup scope**: Phase 7 completes the architecture cleanup deferred from earlier
  phases. Remove the `Extractor` compatibility facade, remove the `StateStore` / `StateFile` /
  `StateBranchEntry` compatibility aliases in favor of checkpoint terms, and have `src/index.ts`
  construct the coordinator, stage instances, checkpoint store, sink, and progress reporter
  directly at the runtime edge.
- **New runtime dependencies**: none.

#### Deferred Design Controls

- **Why deferred**: Phase 7 now has a fixed UX contract, but part of the implementation design
  depends on the implemented shape of predecessor phases rather than their intended architecture on
  paper. In particular, the feasibility and ownership details for timer-driven heartbeat refresh,
  redraw behavior under event-loop blocking work, and any fallback strategy were contingent on the
  Phase 6 implementation establishing the real runtime control flow. Phase 6 is now complete;
  the blocking uncertainty has been resolved. The remaining deferred items (concrete heartbeat
  strategy, exact Core progress-event types, final target-file list) are implementation-design
  choices for the refinement session, not Phase 6 unknowns.
- **Phase 6 profiling shape (for reference)**: Phase 6 implemented a hierarchical
  `StageProfiler` / `DefaultStageProfiler` / `ProfilingEntry` system — not the flat
  `ExtractionTimings` bucket approach originally planned. `ExtractionResult.profilingEntries`
  (type: `readonly ProfilingEntry[]`) returns a preorder traversal of the profiler tree with
  path-based names (`elapsed`, `elapsed/planning`, `elapsed/traversal`, `elapsed/git`,
  `elapsed/git/walk-commits`, etc.). The root entry (`profilingEntries[0]`, name `"elapsed"`)
  holds the total wall time for the run. Phase 7 must use this `profilingEntries[0].wallMs` when
  it needs the run-level elapsed time from the Core result, rather than referencing any flat timing
  field. The profiling tree is always produced by the Core (root profiler starts on every run),
  but child stage profilers are only created when `ExtractorConfig.enableProfiling === true`;
  the summary's `Elapsed time` should use the runtime edge's own clock for consistency whether
  `--profile` is set or not.
- **Depends on**: Phases 4, 5, and 6 — all completed. Phase 6 is the direct refinement
  prerequisite because it introduces the hierarchical `StageProfiler` / `profilingEntries` runtime
  shape and the latest stderr/output behavior that Phase 7 extends. All predecessor phases have
  been implemented and reviewed.
- **Fixed before refinement**: the human-facing UX contract is already locked. The phase keeps the
  three-stage stderr model (`Preparing extraction`, `Extracting history`, `Finalizing output`), the
  liveness requirement for every active stage, `spinner + elapsed` as the preferred heartbeat
  signal, the `<= 1s` silence budget, the distinction between heartbeat updates and semantic
  updates, the default summary field order, `--profile` ordering after the summary, `--quiet`
  suppression rules, and the requirement that warnings/errors remain readable. The phase also keeps
  the release intent that obsolete migration-only paths should be cleaned up once the final runtime
  shape is known.
- **To be finalized in refinement**: the concrete implementation strategy for heartbeat refresh;
  whether timer-driven spinner redraw can be guaranteed on the actual post-Phase-6 runtime path;
  whether any event-loop-blocked code paths require a bounded fallback behavior; the exact Core
  progress event types and ownership split needed to realize the UX contract; and the final list of
  target files/tests once predecessor implementation evidence is available.
- **Refinement trigger**: **Met.** Phase 6 implementation and review completed. The repository is
  in the post-Phase-6 state. The trunk session is ready to run a dedicated design refinement
  session for Phase 7.
- **Required inputs**: the current `PLAN.md`; this phase file; Phase 4, 5, and 6 branch-session
  summaries; the implemented repository state after Phase 6; relevant stderr/profiling code paths;
  and the current versions of `architecture.instructions.md` and `cli.instructions.md`.

#### Non-Goals

- Changing JSON output schema or file-rotation semantics.
- Changing CLI parameters introduced in Phase 5.
- Promoting per-stage profiling entries (`ProfilingEntry` tree) into the default summary; that
  remains exclusive to `--profile`.
- Adding color, ETA estimation, percentages, or per-branch/per-file log lines.
- Emitting progress or summaries on stdout.
- Revisiting diff-backend abstraction or broader naming-audit work beyond the explicitly deferred
  migration compatibility paths.

#### Target Files

| File                                       | Action | Notes                                                                                                                                                                                                         |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | Modify | Provisional. Render the three-stage stderr contract, default summary block, optional profile ordering, and whatever final runtime wiring Phase 7 keeps after refinement.                                      |
| `src/cli/args.ts`                          | Modify | Keep `--quiet` / `--profile` help text aligned with the finalized stderr contract.                                                                                                                            |
| `src/core/types.ts`                        | Modify | Provisional. Replace the old scalar reporter contract with the structured phase-aware progress contract and remove obsolete checkpoint aliases if refinement confirms the exact ownership split.              |
| `src/core/extraction-coordinator.ts`       | Modify | Provisional. Emit phase transitions and extraction snapshots while preserving checkpoint ordering and write-after-success rules if the finalized runtime shape still routes progress through the coordinator. |
| `src/core/commit-traversal-extractor.ts`   | Modify | Provisional. Support coordinator-visible commit traversal counting only if predecessor implementation keeps that as the correct counting boundary.                                                            |
| `src/core/extractor.ts`                    | Delete | Provisional. Remove the migration-only compatibility facade only if refinement confirms that direct runtime wiring is still the right cleanup boundary.                                                       |
| `src/core/index.ts`                        | Modify | Provisional. Export the finalized entry points after refinement confirms the post-migration runtime surface.                                                                                                  |
| `test/cli/args.test.ts`                    | Modify | Cover finalized `--quiet` / `--profile` help text and any warning behavior changes.                                                                                                                           |
| `test/core/extraction-coordinator.test.ts` | Modify | Provisional. Assert stage transition events and snapshot semantics if the finalized design keeps the coordinator as the progress-event owner.                                                                 |
| `test/core/extractor.test.ts`              | Modify | Provisional. Replace or redirect tests that target any compatibility facade only after refinement confirms whether that facade is removed.                                                                    |
| `test/index.test.ts`                       | Add    | Provisional. Cover the top-level stderr contract: spinner/elapsed heartbeat behavior, stage lines, summary ordering, profile ordering, and quiet-mode suppression.                                            |

#### Documentation Touchpoints

| File                                                | Section                                         | Action |
| --------------------------------------------------- | ----------------------------------------------- | ------ |
| `README.md`                                         | "CLI" and "Output"                              | Update |
| `docs/usage.md`                                     | "CLI reference" and examples                    | Update |
| `docs/design/architecture.md`                       | "Core Pipeline" and runtime wiring              | Update |
| `.github/instructions/architecture.instructions.md` | "Migration boundary rules" and Phase 7 contract | Update |
| `.github/instructions/cli.instructions.md`          | "Control" and stderr success contract           | Update |
| `.github/roadmap.md`                                | relevant v0.4.0 progress / architecture items   | Remove |

#### Implementation Notes

- Keep the stage labels exactly as planned: `Preparing extraction`, `Extracting history`, and
  `Finalizing output`.
- This phase must not enter a development branch session until a dedicated design refinement
  session resolves the deferred implementation-feasibility items and updates this file to
  implementation-ready.
- Preserve the "only the active stage line updates" rule even when extraction is fast; do not fall
  back to a scrolling progress log.
- The active stage line must continue to refresh at least once per second while work is ongoing,
  even if semantic counters have not changed. Spinner-frame advancement plus elapsed-time refresh is
  the preferred mechanism.
- Prefer deterministic tests with fake clocks and captured stderr buffers over timing-sensitive
  assertions against real terminal output.
- The default summary block should still be printed for zero-record successful runs when
  `--quiet` is absent.
- Warnings remain immediate stderr messages even under `--quiet`; quiet mode only suppresses the
  incidental progress/profiling/success-reporting contract.
- Treat timer-driven liveness refresh as a design requirement to attempt, not as an optional nice
  to have. If event-loop blocking makes the exact spinner behavior unattainable in some code path,
  implementation must document the gap explicitly instead of quietly dropping the liveness goal.

#### Verification

**Automated:**

```bash
npm run build
npm test
npm run format:check
```

**Behavioral checks** (manual CLI invocations or observable output changes):

- Run `gitrail -b <ref> <repository-path>` and confirm stderr shows exactly three stable stage
  lines (`Preparing extraction`, `Extracting history`, `Finalizing output`), with only the active
  line updating in place and with visible liveness refresh at least once per second while a stage
  remains active.
- Run a zero-record successful incremental extraction and confirm the default summary still shows
  `Commits traversed` so the run explains completed work even when `Records written` is `0`.
- Force or simulate a long preparation/finalization path in tests and confirm those stages still
  show heartbeat updates via spinner/elapsed refresh rather than going silent until completion.
- Run `gitrail --profile -b <ref> <repository-path>` and confirm the default summary appears first
  and the aligned profile block appears after a single blank line.
- Run `gitrail --quiet --profile -b <ref> <repository-path>` and confirm progress, summary, and
  profile output are suppressed while warnings/errors still remain visible when applicable.
