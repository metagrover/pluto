# Fix Meeting Finalization Recovery Failure on Meeting End

## Summary

When any meeting ends, Pluto currently fails finalization and falls back to a degraded state showing:
> **Recording saved**  
> *Processing needs recovery before this meeting is complete.*

This prevents meeting analysis and transcript generation from completing normally.

---

## Root Cause Analysis

Investigation revealed two compounding root causes in `AudioManager.tsx` and `captureActivitySession.ts`:

1. **`AudioManager.tsx` — Uncancelled Speaking Monitor During Async Stop:**
   When `stopSession()` is invoked, `recordingEndedAtRef.current` is set immediately, which freezes `getMeetingElapsedSeconds()` at a constant timestamp $T$. However, stopping audio recorders (`micRecorder.stop()`, `NATIVE_AUDIO_STOP`) takes 100–500ms of asynchronous execution. During this window, `stopSpeakingMonitor()` had not yet been called. The `requestAnimationFrame(tick)` loop kept running (30–60 times per second) with `getMeetingElapsedSeconds()` returning the frozen timestamp $T$. Any audio volume change during shutdown invoked `transitionSpeaker(nextSpeaker, T)` with the same timestamp.

2. **`captureActivitySession.ts` — Latching Durability Failure on Zero-Duration Window at `closeAt`:**
   In `transitionSpeaker` and `closeAt`, passing `seconds <= activeWindow.startTime` latched a fatal durability failure (`latchDurabilityFailure()`).
   When `tick()` ran during shutdown with frozen time $T$, `seconds <= activeWindow.startTime` evaluated to `true`, setting `durabilityFailure = true`.
   Even if the user stopped recording at the exact millisecond a speaker window opened, `closeAt(T)` called `latchDurabilityFailure()`.

   When `sealCaptureJournalBeforeFinalization` executed:
   `hasWriteFailure()` returned `true`, causing seal to abort with `{ status: 'recovery_required', reason: 'capture_journal_write_failed' }`. This forced every meeting into the recovery fallback state and prevented downstream transcript validation and AI analysis.

---

## Proposed Changes

### 1. `src/components/AudioManager.tsx`

- Move `stopSpeakingMonitor()` to the very beginning of `stopSession()` (immediately after `beginRecordingFinalization`).
- This guarantees `requestAnimationFrame(tick)` is cancelled before any async recorder shutdown begins, preventing spurious speaker transitions at frozen timestamps.

### 2. `src/utils/captureActivitySession.ts`

- Modify `closeAt(seconds)` to handle zero-duration active windows gracefully.
- If `activeWindow !== null && seconds <= activeWindow.startTime`, call `closeActiveWindow(seconds)` (which clears `activeWindow = null` without adding a zero-duration window) instead of invoking `latchDurabilityFailure()`.
- Only latch a durability failure if `seconds < 0` or `seconds < latestSeconds` (true backward time regression).

### 3. `tests/unit/captureActivitySession.test.ts`

- Update unit tests for `captureActivitySession` to verify that `closeAt` at `activeWindow.startTime` closes cleanly without setting `hasDurabilityFailure() = true`.
- Ensure tests still verify that non-monotonic time regressions (`seconds < latestSeconds`) latch durability failures.

---

## Verification Plan

### Automated Tests
- Run `pnpm exec vitest run tests/unit/captureActivitySession.test.ts`
- Run `pnpm exec vitest run tests/unit/recordingFinalization.test.ts`
- Run `pnpm exec vitest run tests/unit/transcriptTrustState.test.ts`
- Run `pnpm run test`
