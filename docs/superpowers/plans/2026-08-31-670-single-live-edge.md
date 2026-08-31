# Single Live Transcript Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all mutable speech at one live edge and prevent a missing EOU boundary from creating multi-minute transcript blobs.

**Architecture:** Preserve the existing dual-source EOU pipeline and raw evidence. Add a bounded immutable-prefix checkpoint in Pluto's FluidAudio adapter, then make the renderer projection order committed history before tentative source tails regardless of the tails' original timestamps.

**Tech Stack:** Swift actors and XCTest in `native/parakeet-runtime`; TypeScript and Vitest in the Electron renderer.

---

### Task 1: Bound uncommitted recognition spans

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioEouAdapterTests.swift`

- [ ] **Step 1: Write the failing test**

Add an adapter test whose fake backend emits only cumulative partial callbacks across several frames. Construct the manager with a short test-only maximum pending interval and assert that the last partial is promoted to an EOU snapshot once the interval expires, while the following new partial remains provisional.

- [ ] **Step 2: Run the focused native test and verify RED**

Run: `swift test --package-path native/parakeet-runtime --filter FluidAudioEouAdapterTests`

Expected: FAIL because `FluidAudioEouManager` does not accept a bounded pending interval and never promotes a partial snapshot.

- [ ] **Step 3: Implement the minimal adapter checkpoint**

Track when the current non-empty partial began. If it exceeds the bounded interval, promote only the newest partial callback in that append batch to `.eou`; clear the pending clock on a real or synthetic EOU. Keep the backend, decoder state, tokens, transcript text, and final transcription unchanged.

- [ ] **Step 4: Run the focused native test and verify GREEN**

Run: `swift test --package-path native/parakeet-runtime --filter FluidAudioEouAdapterTests`

Expected: PASS.

### Task 2: Enforce one renderer live edge

**Files:**
- Modify: `src/services/liveTranscription/eouTranscriptProjection.ts`
- Test: `tests/unit/eouTranscriptProjection.test.ts`

- [ ] **Step 1: Write the failing test**

Create a projection update sequence where a tentative mic row begins before later committed system rows. Assert that all committed rows remain chronological and every tentative row appears after them.

- [ ] **Step 2: Run the focused renderer test and verify RED**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts`

Expected: FAIL because the projection currently sorts committed and tentative rows together by their first-token timestamp.

- [ ] **Step 3: Implement the minimal ordering invariant**

Sort committed rows chronologically with the current tie-breakers. Append tentative rows afterward in deterministic source order. Do not change text, timestamps, confirmation state, echo reconciliation, or raw inputs.

- [ ] **Step 4: Run the focused renderer test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts`

Expected: PASS.

### Task 3: Verify the surgical slice

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-08-27-670-complete-live-conversation.md`
- Verify the four production/test files listed above plus these two existing #670 records.

- [ ] **Step 1: Run focused live transcript coverage**

Run: `pnpm exec vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/recordingWorkspaceModel.test.ts`

Expected: PASS.

- [ ] **Step 2: Run native EOU coverage**

Run: `swift test --package-path native/parakeet-runtime --filter Eou`

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run: `pnpm exec tsc --noEmit && pnpm exec biome check src/services/liveTranscription/eouTranscriptProjection.ts tests/unit/eouTranscriptProjection.test.ts && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the final diff**

Confirm every changed production line implements either the bounded pending checkpoint or the committed-before-tentative ordering invariant. Preserve the user's unrelated `src/index.css` and `tests/unit/zenAskPlutoDockStyles.test.ts` changes.
