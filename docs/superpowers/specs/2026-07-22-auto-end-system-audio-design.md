# Auto-End System-Audio Probe Design

**Issue:** [#541](https://github.com/metagrover/pluto/issues/541)

## Problem

Pluto's active-call detector asks `runAudioProbe` whether a supported meeting app is producing system audio. During recording, `nativeAudioProcess` is already running to capture system audio. `runAudioProbe` currently treats that process's existence as a successful probe without checking the target meeting-app process IDs, so the detector continually reports high-confidence activity and auto-end never starts its grace period.

## Approved behavior

- A general readiness probe may reuse the fact that Pluto's native capture process is already running.
- A targeted active-call probe with meeting-app process IDs must run the AudioCap probe even while Pluto is recording.
- Targeted probes must continue to exclude Pluto itself and preserve the existing high-, medium-, and low-confidence detector semantics.
- Existing 10-second polling, 60-second app-exit grace, 120-second audio-inactive grace, and cancellation when target audio resumes remain unchanged.

## Design

Add a small policy function to `electron/nativeAudioCapture.ts` that decides whether a running capture process can satisfy a requested probe. It returns true only when capture is running and the request has no valid positive target process IDs. `electron/main.ts` will use that policy before taking its existing fast path.

This keeps process-lifecycle policy testable without launching Electron or recording private audio. The regression test exercises the same inputs used by `DETECT_ACTIVE_CALL`: capture running plus target meeting-app PIDs must not reuse the capture fast path.

## Verification

- RED/GREEN unit test for targeted probes while capture is running.
- Existing active-call detector and auto-end decision tests.
- Biome on changed TypeScript files.
- Changelog validation and full test suite.

## Non-goals

- Changing meeting-app or browser-provider detection.
- Changing grace durations, settings, or user-facing UI.
- Persisting audio samples, transcripts, or private meeting evidence.
