# Parakeet Runtime Reprepare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the next Parakeet final transcription re-prepares its model after the idle runtime child is unloaded.

**Architecture:** The runtime host already emits a transport-failure event whenever it terminates or loses its child. `ParakeetFinalClient` will subscribe to that event and discard its process-scoped preparation cache. The existing final-transcription path will then issue `prepare` to the next child before `transcribe`.

**Tech Stack:** Electron, TypeScript, Vitest.

---

### Task 1: Invalidate stale Parakeet preparation state

**Files:**
- Modify: `tests/unit/parakeetFinalClient.test.ts`
- Modify: `electron/transcription/parakeetFinalClient.ts`
- Create: `docs/changelog/entries/2026-08-20-630-parakeet-runtime-reprepare.md`

- [ ] **Step 1: Write a failing idle-runtime restart test**

Create two fake native children and a runtime host with a one-millisecond idle timeout. Prepare the first child, advance timers until the host unloads it, then request final transcription. Assert the second child receives `prepare` before it receives `transcribe`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run tests/unit/parakeetFinalClient.test.ts --reporter=dot`

Expected: FAIL because the second child receives `transcribe` without a fresh `prepare`.

- [ ] **Step 3: Invalidate client preparation state on runtime failure**

Subscribe to the host transport failure event in `ParakeetFinalClient` and set `preparePromise` to `null`. The existing `runTranscription` preparation step will then prepare the new child before inference.

- [ ] **Step 4: Run focused verification**

Run: `pnpm exec vitest run tests/unit/parakeetFinalClient.test.ts --reporter=dot`

Expected: PASS.

- [ ] **Step 5: Record the shipped behavior**

Add a content-free changelog fragment linked to #630.

- [ ] **Step 6: Run final checks and commit**

Run: `pnpm exec vitest run tests/unit/parakeetFinalClient.test.ts tests/unit/parakeetRuntimeHost.test.ts --reporter=dot && pnpm run changelog:check && git diff --check`

Commit: `fix(transcription): reprepare Parakeet after runtime unload`

### Task 2: Surface preserved final-transcription failures

**Files:**
- Modify: `src/components/features/downstreamProcessingPresentation.ts`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/unit/downstreamProcessingPresentation.test.ts`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [x] Treat a terminal `parakeet_final_v1` failure as a failed transcript state, not analysis in progress.
- [x] Provide one retry action that reuses the saved meeting recovery path.
- [x] Verify the renderer state and runtime restart regression together.
