# Dynamic Audio Device Reconnect Listeners for Crash-Safe Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide dynamic, crash-safe audio device reconnection and route switching across renderer and native capture runtimes without dropped audio frames, truncated speech, pitch distortion, or blocking error modals.

**Architecture:** A fractional 16 kHz mono resampler decouples arbitrary hardware input sample rates from the VAD/ASR pipeline; `AudioManager.tsx` manages a debounced `reconfiguring` state machine that drains in-flight audio buffers before cleanly swapping media streams; native `audiocap` uses CoreAudio property listeners with a 3-second watchdog and outer recreation loop to withstand transitional Bluetooth/USB states.

**Tech Stack:** TypeScript, React, Web Audio API, CoreAudio (Swift), Vitest.

---

### Task 1: Fractional Audio Resampler (`src/utils/audioResampler.ts`)

**Files:**
- Create: `src/utils/audioResampler.ts`
- Create: `tests/unit/audioResampler.test.ts`

- [ ] **Step 1: Write the failing tests**
  Write tests covering:
  - 48 kHz $\to$ 16 kHz downsampling (3:1 integer decimation).
  - 44.1 kHz $\to$ 16 kHz downsampling (fractional interpolation).
  - 24 kHz $\to$ 16 kHz downsampling (1.5:1 fractional decimation).
  - 16 kHz $\to$ 16 kHz passthrough shortcut.
  - Sine wave frequency retention: 440 Hz test tone at 48 kHz resampled to 16 kHz maintains 440 Hz peak without pitch shift.
  - Multi-chunk streaming continuity: verify phase continuity across consecutive chunk calls.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm vitest run tests/unit/audioResampler.test.ts`
  Expected: FAIL with module not found or functions undefined.

- [ ] **Step 3: Implement `createAudioResampler`**
  Implement windowed fractional resampler with phase accumulation, carryover interpolation state, and dynamic `setInputSampleRate` method.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm vitest run tests/unit/audioResampler.test.ts`
  Expected: PASS all tests.

- [ ] **Step 5: Commit**
  ```bash
  git add src/utils/audioResampler.ts tests/unit/audioResampler.test.ts
  git commit -m "feat(audio): add fractional 16kHz audio resampler with streaming carryover (#746)"
  ```

---

### Task 2: Capture Health State Machine & UI Integration (`recordingWorkspaceModel.ts`)

**Files:**
- Modify: `src/components/features/recordingWorkspaceModel.ts`
- Modify: `tests/unit/RecordingWorkspaceComponents.test.tsx`

- [ ] **Step 1: Write the failing test**
  Add unit tests in `RecordingWorkspaceComponents.test.tsx` verifying:
  - `CaptureHealth` supports `'reconfiguring'`.
  - When `microphone === 'reconfiguring'`, `statusMessage` reports `'Reconfiguring audio devices...'` and `needsAttention` is `false`.
  - When `systemAudio === 'reconfiguring'`, `statusMessage` reports `'Reconfiguring audio devices...'` and `needsAttention` is `false`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`
  Expected: FAIL due to missing `'reconfiguring'` type support.

- [ ] **Step 3: Implement `'reconfiguring'` health status**
  Update `CaptureHealth` type definition and `buildRecordingWorkspaceModel` in `src/components/features/recordingWorkspaceModel.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`
  Expected: PASS all tests.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/features/recordingWorkspaceModel.ts tests/unit/RecordingWorkspaceComponents.test.tsx
  git commit -m "feat(recording): support reconfiguring capture health state (#746)"
  ```

---

### Task 3: Renderer Dynamic Device Reconnect & In-Flight Buffer Preservation (`AudioManager.tsx`)

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Create: `tests/unit/audioDeviceReconnect.test.ts`

- [ ] **Step 1: Write the failing tests**
  Create `tests/unit/audioDeviceReconnect.test.ts` testing:
  - Event listener attached to `navigator.mediaDevices.ondevicechange`.
  - Debouncing multiple rapid `devicechange` events into a single reconfiguration cycle.
  - In-flight audio buffers in `micPcmChunksRef` and `eouSessionRef` are drained before tearing down defunct nodes.
  - Disconnects previous processor, source, analyser, and stops defunct tracks.
  - Re-acquires `getUserMedia`, updates resampler with new sample rate, reconnects graph, and restores health to `healthy`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm vitest run tests/unit/audioDeviceReconnect.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement device change handler and resampler integration in `AudioManager.tsx`**
  - Integrate `createAudioResampler` into microphone capture pipeline.
  - Wire `navigator.mediaDevices.addEventListener('devicechange', ...)` during active recording.
  - Implement coalesced drain $\to$ teardown $\to$ re-acquire $\to$ re-attach state machine.
  - Clean up event listeners and resamplers on session stop and component unmount.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm vitest run tests/unit/audioDeviceReconnect.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/AudioManager.tsx tests/unit/audioDeviceReconnect.test.ts
  git commit -m "feat(audio): add dynamic device reconnect and buffer drain in AudioManager (#746)"
  ```

---

### Task 4: Native CoreAudio Route Listener & Watchdog in `audiocap`

**Files:**
- Modify: `resources/swift/audiocap/ProcessTap.swift`
- Modify: `resources/swift/audiocap/main.swift`
- Test: `tests/unit/audiocapPcmContract.test.ts`

- [ ] **Step 1: Add CoreAudio property listeners and reconnect watchdog in `audiocap`**
  - Add `AudioObjectPropertyListenerBlock` for:
    - `kAudioHardwarePropertyDefaultOutputDevice`
    - `kAudioHardwarePropertyDefaultInputDevice`
    - `kAudioHardwarePropertyDevices`
  - Implement outer tap recreation loop with transient error handling for `kAudioHardwareBadObjectError`.
  - Add 3-second frame-receipt watchdog timer that auto-retries tap recreation if zero frames arrive after route switch.
  - Cleanly teardown previous aggregate device and IO proc before recreation.

- [ ] **Step 2: Compile native `audiocap` binary**
  Run: `swiftc resources/swift/audiocap/*.swift -o resources/bin/audiocap -framework CoreAudio -framework AudioToolbox -framework AVFoundation`
  Expected: Successful compilation without warnings or errors.

- [ ] **Step 3: Verify with probe and contract tests**
  Run: `./resources/bin/audiocap --probe --probe-ms 500 --probe-silent`
  Run: `pnpm vitest run tests/unit/audiocapPcmContract.test.ts`
  Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add resources/swift/audiocap/ProcessTap.swift resources/swift/audiocap/main.swift
  git commit -m "feat(native): add CoreAudio route listener and tap watchdog in audiocap (#746)"
  ```

---

### Task 5: Decision Record, Changelog, Verification & PR

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/746-dynamic-audio-reconnect.md`

- [ ] **Step 1: Update `docs/decisions.md`**
  Record durable decision on uniform 16 kHz resampling boundary and non-modal reconfiguring state machine.

- [ ] **Step 2: Create changelog entry**
  Add `docs/changelog/entries/746-dynamic-audio-reconnect.md` and run `pnpm run changelog:check`.

- [ ] **Step 3: Run full verification suite**
  Run all audio, capture, and workspace tests:
  `pnpm vitest run tests/unit/audio* tests/unit/capture* tests/unit/Recording*`
  `pnpm run lint`

- [ ] **Step 4: Commit and Push**
  ```bash
  git add docs/decisions.md docs/changelog/entries/
  git commit -m "docs: add decision record and changelog for dynamic audio reconnect (#746)"
  git push -u origin feat/746-dynamic-audio-reconnect
  ```

- [ ] **Step 5: Create Pull Request**
  Use `gh pr create` referencing Issue #746.
