# Capture Journal Recovery Failure Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure one failed interrupted-journal recovery cannot block later healthy recordings during launch.

**Architecture:** Add a per-journal exception boundary around the existing recovery transaction and report aggregate failures in the typed result. Keep filesystem artifacts immutable and reuse the launch summary for content-free diagnostics.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

### Task 1: Prove per-journal failure isolation

**Files:**
- Modify: `tests/unit/captureJournalRecovery.test.ts`

- [ ] Add two interrupted journals and make stitching reject for the first meeting.
- [ ] Assert the test fails because the recovery promise currently rejects.
- [ ] Expect the second journal to save, `recoveredCount` to be one, and `failedRecoveryCount` to be one.

### Task 2: Isolate recovery transactions

**Files:**
- Modify: `electron/captureJournalRecovery.ts`

- [ ] Add `failedRecoveryCount` to `CaptureJournalRecoveryResult`.
- [ ] Wrap each journal's segment validation, stitching, and save boundary in `try/catch`.
- [ ] Increment the counter and continue without mutating the failed journal.
- [ ] Run the focused test and confirm it passes.

### Task 3: Surface aggregate launch diagnostics

**Files:**
- Modify: `electron/main.ts`
- Create: `docs/changelog/entries/2026-07-16-499-journal-recovery-failure-isolation.md`

- [ ] Include `failedRecoveryCount` in the existing launch-summary condition.
- [ ] Record the issue-scoped product trust change without private data.
- [ ] Run focused and full verification.
