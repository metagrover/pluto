# Bound Transcript-Validation Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transcript-validation retry a bounded, durable, cancellable lease that cannot strand a meeting in `validating`.

**Architecture:** Add pure lease parsing/deadline helpers, transactional database claim/update/recovery operations, and a retry orchestration boundary that preserves evidence and separates validation from downstream generation. Propagate timeout cancellation to Electron and render the durable stage without invented progress.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3 transactions, React, Vitest.

---

### Task 1: Define retry lease semantics

**Files:**
- Create: `src/services/transcriptValidationRetryLease.ts`
- Test: `tests/unit/transcriptValidationRetryLease.test.ts`

- [ ] Write failing tests for lease parsing, duration-scaled deadlines, expiry,
  evidence-preserving lease insertion, and terminal failure evidence.
- [ ] Run `pnpm exec vitest run tests/unit/transcriptValidationRetryLease.test.ts`
  and confirm the helpers are missing.
- [ ] Implement the smallest pure helpers and retry failure types needed by the
  tests.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Add atomic database lease operations

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Test: `tests/unit/transcriptValidationRetryPersistence.test.ts`

- [ ] Write failing database tests proving only one live retry can claim a
  meeting, prior evidence survives, current-run stage/final saves succeed,
  stale saves fail, and expired leases recover to `needs_attention`.
- [ ] Run the focused test and confirm the claim API is missing.
- [ ] Implement transactional claim, stage update, current-run save, and expired
  lease recovery operations; expose narrow IPC handlers.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Bound and cancel validation orchestration

**Files:**
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `electron/main.ts`
- Modify: `electron/whisperx.ts`
- Test: `tests/unit/retryMeetingTranscriptValidation.test.ts`
- Test: `tests/unit/whisperxCancellation.test.ts`

- [ ] Add failing tests for timeout, thrown transcription, supersession in each
  terminal path, late completion, cancellation invocation, preserved evidence,
  and no downstream generation after a non-successful validation.
- [ ] Run both focused suites and confirm the new expectations fail.
- [ ] Implement injected clock/deadline support, atomic claim use, conditional
  recovery, and the meeting cancellation IPC. Recycle only a Pluto-owned
  sidecar; never terminate an external server.
- [ ] Durably save a validated transcript before title/analysis/entity work.
- [ ] Re-run focused suites and confirm they pass.

### Task 4: Render durable retry state

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/App.tsx`
- Test: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [ ] Add failing rendering tests for durable stage text, reload behavior, and
  recoverable timeout/failure copy.
- [ ] Run the focused test and confirm the new copy is absent.
- [ ] Pass the integrity payload to the panel and render content-free stage and
  failure state without percentage progress.
- [ ] Re-run the focused test and confirm it passes.

### Task 5: Record and verify delivery

**Files:**
- Create: `docs/changelog/entries/2026-07-21-539-bound-validation-retry.md`

- [ ] Add an issue-scoped changelog fragment with `Issue`, `PR`, `Changed`,
  `Why`, `Replaced`, and `Notes` fields.
- [ ] Run all retry, persistence, cancellation, and meeting-view focused tests.
- [ ] Run `pnpm run changelog:check`, changed-file Biome checks, and the relevant
  TypeScript check.
- [ ] Inspect the complete diff and obtain an independent code review.
- [ ] Push the branch, open a PR linked to #539, and update the issue with
  verification evidence that contains no private meeting content.

### Task 6: Audit and repair the latest private transcript

**Files:**
- Local application data only; no repository or GitHub artifacts.

- [ ] Generate independent local transcripts from preserved mic, system, and
  mixed audio using bounded source-by-source processing.
- [ ] Compare word/timestamp alignment and speaker evidence across sources,
  flagging lexical disagreement, omissions, hallucinations, and attribution
  conflicts.
- [ ] Build a corrected canonical transcript locally, preserving uncertainty
  where audio is ambiguous instead of guessing.
- [ ] Back up the database, conditionally save the corrected transcript and
  integrity evidence, then reload Pluto and verify the meeting is readable.
- [ ] Report only aggregate quality results unless the user explicitly asks to
  display private transcript text.
