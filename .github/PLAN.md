# gitrail — v0.2.0 Release Plan

## Overview

This plan covers the release following v0.1.4.
The target version is **v0.2.0**.

v0.2.0 is the first release with a deliberate minor-version increment. As this project is still pre-1.0.0, this release may introduce breaking changes to the CLI interface. All such changes will be documented in the changelog.

The primary focus is on stabilizing the CLI contract early — particularly around how users specify extraction intent and manage state files — and on cleaning up the architecture before the codebase grows further.

## Release Goals

- Establish a stable, explicit CLI interface for extraction modes and state management
- Prevent accidental data overwrites caused by repeated runs in the same output directory
- Improve cross-session correctness when users add new branches over time
- Reduce architecture coupling in the core layer to improve testability and future feature velocity
- Improve help discoverability for new users

## Scope Summary

### Included in v0.2.0

- Refactor the extractor boundary to move runtime concerns (stderr, timing, state I/O) behind explicit abstractions
- Apply `readonly` modifiers across all pure data interfaces and types
- Add execution-time uniqueness to rotated output filenames to prevent overwrite across sessions
- Introduce explicit extraction mode (`--mode full|incremental`) and improve state ergonomics (`--state-dir`, `--on-missing-state`)
- Add merge-base-based cross-run deduplication when new branches are added across sessions
- Group `--help` output by category for better discoverability
- Update documentation and changelog entries for the release

### Explicitly excluded from v0.2.0

- Progress metrics redesign and phase-level observability
- Configurable field inclusion or exclusion
- All long-term output, schema, and streaming features

---

## Phase 1: Extractor Boundary Cleanup for Runtime and I/O Concerns

_Introduce explicit abstractions for stderr output, timing, and state persistence in the core layer, replacing direct runtime coupling in `extractor.ts`._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 2: TypeScript `readonly` Audit

_Apply `readonly` modifiers to all interface fields and collection types used as pure data or configuration, starting from value types and working inward._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 3: Output Filename Uniqueness Across Sessions

_Include a session-unique identifier (execution timestamp) in rotated output filenames so repeated runs in the same directory do not overwrite prior results._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 4: Explicit Extraction Mode and State Ergonomics

_Add a `--mode` flag for explicit full vs incremental intent, introduce `--state-dir` for automatic state file derivation, and add `--on-missing-state` to control behavior when the expected state file is absent._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 5: Cross-Run Deduplication for Newly Added Branches

_When branches are added across sessions, compute the merge base with previously seen branches and use it as the traversal boundary, preventing duplicate commits in downstream output._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 6: Help Option Grouping and Discoverability

_Group CLI options under labelled sections in the `--help` output and add descriptive notes to guide users toward the incremental extraction workflow._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Phase 7: Release Documentation and Notes

_Update the README, changelog, and any migration notes to reflect breaking CLI changes and new behavior introduced in this release._

### Status

- [ ] Planned
- [ ] In progress
- [ ] Completed

---

## Final Verification Checklist

_To be filled in when phase implementation detail is finalized._

---

## Release Intent Summary

v0.2.0 is a **CLI stability and architecture release**.
It establishes the intended CLI contract for extraction modes and state management, prevents operational hazards in repeated runs, and cleans up core architecture before the codebase grows further.
Breaking changes to the CLI interface are intentional and will be documented in the changelog.