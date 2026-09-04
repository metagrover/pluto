# Dynamic Audio Device Reconnect Listeners for Crash-Safe Capture Design Spec

- **Issue**: [Issue #746](https://github.com/metagrover/pluto/issues/746)
- **Status**: Approved
- **Date**: 2026-09-04

---

## 1. Overview & Problem Statement

When users switch audio devices mid-meeting (e.g. connecting or disconnecting Bluetooth headphones such as AirPods, plugging in a USB microphone, or changing system default output routes), hardware sample rates and audio streams change dynamically (e.g., switching between 44.1/48 kHz high-fidelity audio and 16/24 kHz Bluetooth SCO voice profiles).

Currently, active recording streams in `AudioManager.tsx` and native audio capture do not dynamically handle hardware route invalidation. As a result, switching devices during an active call can cause:
1. Silent capture failure where the input track goes silent or stops producing PCM buffers.
2. Buffer underruns or sample rate corruption feeding into the VAD and rolling audio buffer.
3. Native audio tap crashes or hangs when referencing deallocated CoreAudio hardware ports.

Pluto must gracefully survive audio input and output device changes during an active recording session without user intervention, dropped audio frames, or runtime crashes.

---

## 2. Architecture & Lifecycle State Machine

```
               [ OS Audio Subsystem / CoreAudio ]
                    │                        │
       devicechange │                        │ kAudioHardwareProperty*
                    ▼                        ▼
        ┌──────────────────────┐  IPC   ┌────────────────────────┐
        │   AudioManager.tsx   │◄───────┤     audiocap (CLI)     │
        │ (Renderer Mic & VAD) │        │ (Native System Output) │
        └──────────┬───────────┘        └───────────┬────────────┘
                   │                                │
                   ▼                                ▼
       [ 16 kHz Audio Resampler ]        [ Tap Restart Watchdog ]
                   │                                │
                   ▼                                ▼
        ┌────────────────────────────────────────────────────────┐
        │           Unified Capture Journal (Append-Only)        │
        └────────────────────────────────────────────────────────┘
```

### Capture States
- `unstarted`: No active recording.
- `starting`: Initializing capture pipeline and verifying permissions.
- `recording`: Steady-state audio capture actively streaming PCM.
- `reconfiguring`: Transitional state while route switch or device change is resolving.
- `stopping`: Finalizing session and sealing capture journal.

### State Transitions on Route Switch
1. **Trigger**: `navigator.mediaDevices.ondevicechange` fires or native route change signal is received.
2. **Debounce & Coalescing**: 200ms debounce window coalesces rapid multi-device registrations (e.g., Bluetooth device adding both input and output endpoints).
3. **Transition to `reconfiguring`**:
   - `publishCaptureHealth({ microphone: 'reconfiguring', systemAudio: 'reconfiguring', captureDurability: current })`
   - UI status displays non-intrusive reconfiguring status without popping fatal modal dialogs.
4. **Drain In-Flight Speech Buffers**:
   - Drain accumulated PCM samples in `micPcmChunksRef.current` and commit into active frame.
   - Flush pending chunker frames in `eouSessionRef.current` to preserve in-flight words.
5. **Clean Audio Graph Teardown**:
   - Disconnect `micPcmProcessorRef`, `micPcmSourceRef`, and `micAnalyserRef`.
   - Call `.stop()` on every track in `micStreamRef.current`.
6. **Graph Reconstruction & Resampler Adaptation**:
   - Call `navigator.mediaDevices.getUserMedia(...)`.
   - Inspect new input sample rate ($f_{in}$).
   - Configure `audioResampler` to resample $f_{in} \to 16000\text{ Hz}$.
   - Connect new source through processor and analyser.
7. **Transition to `healthy`**:
   - Capture state returns to `recording`, capture health to `healthy`.
   - Append-only journal continues with monotonic sequence numbers.

---

## 3. Uniform 16 kHz Resampling Pipeline (`src/utils/audioResampler.ts`)

### Rationale
Downstream speech processing components (VAD, RMS calculation, Parakeet EOU chunker, and journal chunks) strictly expect 16 kHz mono Float32 audio. A duration mismatch ($|declared - actual| > 0.5 / rate$) or pitch shift causes fatal pipeline errors (`parakeet_request_invalid`).

### Specification
- **Interface**:
  ```ts
  export interface AudioResampler {
    setInputSampleRate(rate: number): void;
    process(input: Float32Array): Float32Array;
    flush(): Float32Array;
    reset(): void;
  }
  ```
- **Algorithm**:
  - Windowed band-limited fractional interpolation with phase accumulation.
  - Maintains filter carryover state across chunk boundaries to avoid clicking, boundary transients, or phase discontinuity.
  - Supports dynamic updates via `setInputSampleRate(rate)`.
  - Passthrough shortcut when $f_{in} == 16000$ to avoid unnecessary allocations and CPU cycles.

---

## 4. Native CoreAudio Route Listener & Tap Watchdog (`audiocap`)

### 1. Route Observation
In `resources/swift/audiocap/`:
- Register `AudioObjectAddPropertyListenerBlock` on `AudioObjectID(kAudioObjectSystemObject)` for:
  - `kAudioHardwarePropertyDefaultOutputDevice`
  - `kAudioHardwarePropertyDefaultInputDevice`
  - `kAudioHardwarePropertyDevices`
- When properties change, dispatch to the serial `AudioCapQueue`.

### 2. Safe Tap & Aggregate Rebuild
- Destroy previous `deviceProcID`, aggregate device (`AudioHardwareDestroyAggregateDevice`), and tap (`AudioHardwareDestroyProcessTap`) before re-creating.
- Re-query new default output device UID.
- Outer retry loop (up to 3 attempts, 200ms sleep) handling `kAudioHardwareBadObjectError` (`OSStatus 560947818`) during aggregate device registration.

### 3. Tap-Restart Watchdog
- CoreAudio can fire `kAudioHardwarePropertyDefaultOutputDevice` before Bluetooth profile negotiation finishes.
- Schedule a 3-second watchdog timer after rebuilding the tap.
- If zero audio frames arrived after the restart, automatically trigger a bounded retry of the tap rebuild (bounded to 2 retries).
- Genuine new OS route notifications reset the retry budget.

---

## 5. Capture Health & UI Reporting

- Extend `CaptureHealth`:
  ```ts
  export type CaptureHealth = 'healthy' | 'warning' | 'unavailable' | 'reconfiguring';
  ```
- In `buildRecordingWorkspaceModel`:
  - When `microphone === 'reconfiguring' || systemAudio === 'reconfiguring'`:
    - `statusMessage`: `'Reconfiguring audio devices...'`
    - `needsAttention`: `false` (does not flag as an error; prevents disruptive modal warnings).

---

## 6. Verification Plan

1. **Unit Tests**:
   - `src/utils/audioResampler.test.ts`: test resampling from 48 kHz, 44.1 kHz, 24 kHz, 16 kHz to 16 kHz mono. Test sine wave frequency retention (pitch stability) and chunk continuity.
   - `tests/unit/audioDeviceReconnect.test.ts`: simulate `devicechange` events, verify coalescing, in-flight buffer drain, and capture health transitions.
2. **Integration Tests**:
   - `tests/unit/audioManagerParakeetEouWiring.test.ts`: verify EOU wiring functions smoothly across sample rate transitions.
   - `tests/unit/audiocapPcmContract.test.ts`: verify native tap frame formats and contract compliance.
3. **Build Verification**:
   - Compile `audiocap` native binary.
   - Run complete vitest test suite.
