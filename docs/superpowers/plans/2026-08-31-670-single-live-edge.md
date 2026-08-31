# Single Live Transcript Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all mutable speech at one live edge and prevent a missing EOU boundary from creating multi-minute transcript blobs.

**Architecture:** Preserve the existing dual-source EOU pipeline and raw evidence. Add a bounded immutable-prefix checkpoint in Pluto's FluidAudio adapter, but commit only through a proven SentencePiece word boundary and retain the unfinished word as provisional. Evaluate pending state on every audio frame and reduce callback batches in order. Make the renderer projection order committed history before tentative source tails, while presenting tentative turn time as `Live` instead of an unexplained backwards clock value.

**Review correction:** The first implementation promoted an arbitrary partial wholesale. Adversarial review showed that this could split a SentencePiece word, miss its deadline during callback-free silence, ignore a partial trailing an EOU in the same batch, and still display a backwards timestamp at the live edge. Tasks 1-3 record the completed first pass; Tasks 4-6 supersede its unsafe boundary and incomplete presentation behavior.

**Tech Stack:** Swift actors and XCTest in `native/parakeet-runtime`; TypeScript and Vitest in the Electron renderer.

---

### Task 1: Bound uncommitted recognition spans

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioEouAdapterTests.swift`

- [x] **Step 1: Write the failing test**

Add an adapter test whose fake backend emits only cumulative partial callbacks across several frames. Construct the manager with a short test-only maximum pending interval and assert that the last partial is promoted to an EOU snapshot once the interval expires, while the following new partial remains provisional.

- [x] **Step 2: Run the focused native test and verify RED**

Run: `swift test --package-path native/parakeet-runtime --filter FluidAudioEouAdapterTests`

Expected: FAIL because `FluidAudioEouManager` does not accept a bounded pending interval and never promotes a partial snapshot.

- [x] **Step 3: Implement the minimal adapter checkpoint**

Track when the current non-empty partial began. If it exceeds the bounded interval, promote only the newest partial callback in that append batch to `.eou`; clear the pending clock on a real or synthetic EOU. Keep the backend, decoder state, tokens, transcript text, and final transcription unchanged.

- [x] **Step 4: Run the focused native test and verify GREEN**

Run: `swift test --package-path native/parakeet-runtime --filter FluidAudioEouAdapterTests`

Expected: PASS.

### Task 2: Enforce one renderer live edge

**Files:**
- Modify: `src/services/liveTranscription/eouTranscriptProjection.ts`
- Test: `tests/unit/eouTranscriptProjection.test.ts`

- [x] **Step 1: Write the failing test**

Create a projection update sequence where a tentative mic row begins before later committed system rows. Assert that all committed rows remain chronological and every tentative row appears after them.

- [x] **Step 2: Run the focused renderer test and verify RED**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts`

Expected: FAIL because the projection currently sorts committed and tentative rows together by their first-token timestamp.

- [x] **Step 3: Implement the minimal ordering invariant**

Sort committed rows chronologically with the current tie-breakers. Append tentative rows afterward in deterministic source order. Do not change text, timestamps, confirmation state, echo reconciliation, or raw inputs.

- [x] **Step 4: Run the focused renderer test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts`

Expected: PASS.

### Task 3: Verify the surgical slice

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-08-27-670-complete-live-conversation.md`
- Verify the four production/test files listed above plus these two existing #670 records.

- [x] **Step 1: Run focused live transcript coverage**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/recordingWorkspaceModel.test.ts`

Expected: PASS.

- [x] **Step 2: Run native EOU coverage**

Run: `swift test --package-path native/parakeet-runtime --filter Eou`

Expected: PASS.

- [x] **Step 3: Run static checks**

Run: `pnpm exec tsc --noEmit && pnpm exec biome check src/services/liveTranscription/eouTranscriptProjection.ts tests/unit/eouTranscriptProjection.test.ts && git diff --check`

Expected: all commands exit 0.

- [x] **Step 4: Inspect the final diff**

Confirm every changed production line implements either the bounded pending checkpoint or the committed-before-tentative ordering invariant. Preserve the user's unrelated `src/index.css` and `tests/unit/zenAskPlutoDockStyles.test.ts` changes.

### Task 4: Make native checkpoints word-safe and frame-driven

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioEouAdapterTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetEouSessionTests.swift`

- [x] **Step 1: Add failing regressions**

Cover a checkpoint at an unfinished SentencePiece word, callback-free frames crossing the deadline, and an EOU followed by a new partial in one callback batch. Exercise the manager snapshots through `ParakeetEouSession` so a later continuation cannot terminate the stream as `prefix_mutated`.

- [x] **Step 2: Implement the minimal safe state machine**

Retain the latest snapshot and token boundary evidence. At the deadline, emit an EOU only through the last completed word and keep the unfinished word as a partial. Evaluate elapsed audio on every frame and reduce callbacks in their original order so the last meaningful callback determines pending state.

- [x] **Step 3: Verify focused native coverage**

Run the adapter and EOU session suites and confirm every new regression passes.

### Task 5: Make the live-edge time truthful

**Files:**
- Modify: `src/components/features/LiveTranscript.tsx`
- Test: `tests/unit/LiveTranscript.dom.test.tsx`

- [x] **Step 1: Add the failing rendered regression**

Render a later confirmed turn followed by an older tentative turn and assert that the confirmed turn retains its meeting time while the tentative turn displays `Live`.

- [x] **Step 2: Implement the minimal presentation change**

Preserve every segment timestamp internally. Change only the visible time label for a turn containing provisional speech.

- [x] **Step 3: Verify focused renderer coverage**

Run projection, presentation, reconciliation, workspace-model, and DOM transcript tests.

### Task 6: Re-run delivery gates

- [x] Run TypeScript, focused Biome, diff checks, the full JavaScript suite, the complete native EOU suite, production renderer build, native production rebuild, signature checks, and Electron SQLite ABI restoration.
- [x] Update the existing #670 decision and changelog text to describe word-safe checkpoints and the explicit `Live` label.
- [x] Apply the verified commits to the requested active checkout without disturbing unrelated work. Keep rendered long-meeting acceptance open until observed in a real call.
