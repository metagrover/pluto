# WebRTC AudioProcessing Spike

- Status: evaluated
- Date: 2026-08-16
- Issue: #629

## Decision

Use only PulseAudio's external `webrtc-audio-processing` v2.1 source for this experiment, pinned to `846fe90a289f58b7c9303a635142aa2c7caa93e5`. Pluto contains no AEC/DSP implementation. The isolated C++ runner only feeds upstream AudioProcessing paired 16 kHz mono 10 ms PCM frames in this order: reverse frame, configured delay, capture frame. The spike result is `no_backend_selected`.

## Evidence

A clean arm64 build produced `libwebrtc-audio-processing-2.1.dylib` (1.1 MB, SHA-256 `67d23c715181f38b9110a0e3ebdc56a892bdec4b7328360453361a8df9c87518`). Repeated runs produced identical residual SHA-256 digests for all synthetic cases.

On generated five-second paired fixtures, the 0–200 ms delay cases measured 19.69–38.20 dB ERLE with post-cancellation correlation at or below 0.00538. The -100, 0, and +100 ppm drift cases measured 24.11–39.77 dB ERLE with post-cancellation correlation at or below 0.00561. These are promising residual measurements, not complete quality-gate evidence: the upstream API does not expose the measured delay-estimation error, drift-tracking error, or local-signal preservation values required by the frozen gates. The TypeScript scorer therefore requires those reported measurements and returns `no_backend_selected` when they are absent.

## Scope boundary

This is not production wiring: no Electron, capture, finalization, renderer, package, or runtime build file imports the spike. A separately approved design is required before any production integration. The immediate next action is to establish independently measurable delay/drift and local-preservation metrics; absent that evidence, do not pivot. No Pluto fallback DSP may be added.
