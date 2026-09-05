# Durable Sealed Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sealed provisional meeting with missing materialized audio resume after restart and reach the existing canonical Parakeet pipeline without being falsely presented as finalized.

**Architecture:** Keep capture release fast, but persist a truthful `processing` finalization state. Startup recovery may reopen only a generation-matching sealed provisional row with missing required artifacts, preserve its provisional transcript and user metadata, materialize both sources plus the mix, and then let the existing app-wide final-transcription coordinator continue. Replace the complete contiguous-journal FFmpeg graph with one sequential concat input and one timeline delay/pad operation; retain the old sparse-timeline path for legacy gaps.

**Tech Stack:** Electron, TypeScript, SQLite, FFmpeg/fluent-ffmpeg, Vitest.

---

### Task 1: Truthful finalization state

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/utils/recordingFinalization.ts`
- Test: `tests/unit/audioManagerParakeetEouWiring.test.ts`
- Test: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [x] **Step 1: Write failing tests** asserting the provisional sealed handoff contains `finalization_status: 'processing'` and `canDeleteMeeting('processing')` is false.
- [x] **Step 2: Run** `pnpm vitest run tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx` and confirm the new expectations fail against `finalized` and the current deletion predicate.
- [x] **Step 3: Implement** `MeetingFinalizationStatus = 'processing' | 'finalized' | 'needs_attention' | 'recovery_required'`, persist `processing` in the provisional row, and block deletion while processing or recovery is required.
- [x] **Step 4: Re-run the focused tests and confirm they pass.**

### Task 2: Resume an existing sealed provisional row

**Files:**
- Modify: `electron/captureJournalRecovery.ts`
- Modify: `electron/main.ts`
- Test: `tests/unit/captureJournalRecovery.test.ts`

- [x] **Step 1: Write a failing recovery test** with a sealed v3 journal, matching `capture_journal_generation`, `transcript_status: 'provisional'`, `finalization_status: 'processing'`, and null audio paths. Assert recovery materializes mic, System, and mix; preserves transcript/title/notes; saves `processing`; and does not increment either sealed/existing skip counter.
- [x] **Step 2: Run** `pnpm vitest run tests/unit/captureJournalRecovery.test.ts` and confirm the row is currently skipped.
- [x] **Step 3: Add** a narrow `isResumableSealedMeeting` predicate requiring sealed v3 evidence, matching generation, provisional transcript state, non-recovery finalization, and at least one missing required audio artifact. Do not reopen validated or generation-mismatched rows.
- [x] **Step 4: Extend recovery dependencies** with `mixWavSources(inputPaths, outputTag)` and construct the mix after both source paths exist. Preserve the existing provisional transcript and metadata for this path; retain the existing `needs_attention` recovery behavior for genuinely interrupted or gapped journals.
- [x] **Step 5: Re-run the recovery test and the complete recovery suite.**

### Task 3: Make final-transcription eligibility truthful

**Files:**
- Modify: `src/services/postMeetingProcessingCoordinator.ts`
- Test: `tests/unit/postMeetingProcessingCoordinator.test.ts`

- [x] **Step 1: Add failing cases** proving a processing provisional meeting with sealed generation and complete mic/System/mix paths is eligible, while the same row with missing materialization remains ineligible and a recovery-required row remains blocked.
- [x] **Step 2: Run** `pnpm vitest run tests/unit/postMeetingProcessingCoordinator.test.ts` and confirm the processing case fails if current typing or predicates reject it.
- [x] **Step 3: Implement the minimal predicate change** so only complete recovered inputs enter final ASR; materialization remains startup recovery's responsibility, and recheck the full detail row before starting work.
- [x] **Step 4: Re-run the coordinator suite.**

### Task 4: Sequential contiguous-journal reconstruction

**Files:**
- Create: `electron/timedWavStitchPlan.ts`
- Modify: `electron/main.ts`
- Test: `tests/unit/timedWavStitchPlan.test.ts`

- [x] **Step 1: Add failing pure tests** for sorted contiguous segments, interior-gap detection, target duration, and a single initial delay derived from the first interval/audio duration.
- [x] **Step 2: Run** `pnpm vitest run tests/unit/timedWavStitchPlan.test.ts` and confirm the missing module fails.
- [x] **Step 3: Implement** a small planner returning `{ mode: 'sequential', initialDelayMs, targetDurationSeconds }` for contiguous input and `{ mode: 'sparse' }` for interior gaps or overlaps outside tolerance.
- [x] **Step 4: In `electron/main.ts`,** use a temporary ffconcat manifest and one FFmpeg input for sequential mode, then apply one delay plus pad/trim and normalize to mono 16 kHz WAV. Always remove the temporary manifest. Keep the current delayed-amix implementation only for sparse legacy input.
- [x] **Step 5: Re-run the planner and recovery suites.**

### Task 5: Fail-closed provisional presentation

**Files:**
- Modify: `src/utils/transcript.ts`
- Test: `tests/unit/transcriptSpeakerPresentation.contract.test.ts`

- [x] **Step 1: Change the existing 50-percent-overlap contract test** to require `Unknown`/`Speaker` for unverified simultaneous mic speech rather than converting it to `Them`; add a test that turn boundaries remain distinct after reading projection.
- [x] **Step 2: Run** `pnpm vitest run tests/unit/transcriptSpeakerPresentation.contract.test.ts` and confirm the overlap expectation fails.
- [x] **Step 3: Remove overlap-based fallback identity promotion.** Preserve System-origin `Them`; preserve clearly non-overlapping mic `Me`; render simultaneous unverified mic speech as `Speaker` until canonical attribution succeeds.
- [x] **Step 4: Re-run transcript presentation and reading-projection suites.**

### Task 6: Integrated verification and durable records

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-09-01-718-finalization-convergence.md`

- [x] **Step 1: Record** the restart-convergence rule and the separation from #739's diagnostic ledger in `docs/decisions.md`.
- [x] **Step 2: Update** the existing #718 product-facing changelog fragment.
- [x] **Step 3: Run** the focused regression suites, `pnpm exec tsc --noEmit`, `pnpm run lint`, and `pnpm run changelog:check`.
- [x] **Step 4: Inspect** `git diff --check`, `git status --short`, and the final diff for unrelated changes.
- [ ] **Step 5: Do not mutate the production database.** After code review and delivery approval, run packaged/runtime recovery against a protected copy before allowing the normal worker to repair the latest meeting.
