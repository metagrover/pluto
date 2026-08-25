# English Parakeet EOU Live Primary Design

**Issue:** [#663](https://github.com/metagrover/pluto/issues/663)  
**Supersedes:** The MLX fallback and visible-live portions of [the #630 live design](./2026-08-15-parakeet-live-transcription-design.md)  
**Status:** Approved for implementation planning  
**Date:** 2026-08-24

## Outcome

Pluto will show an English-only live transcript produced by FluidAudio's true-streaming Parakeet EOU model. MLX Whisper will not be prepared, started, queried, queued, or selected as a transcription fallback. If EOU is unavailable before recording, recording admission fails with a finite readiness reason. If EOU fails during a recording, durable capture continues, the live transcript becomes unavailable, and the existing sealed Parakeet TDT finalization remains the canonical transcript authority after stop.

This phase leaves MLX source and packaging in place only to keep removal independently reviewable. No production recording path may reach it for live or final transcription.

## Product contract

- English is the only supported recognition language. There is no auto-detection or language selector.
- Microphone and System audio have independent EOU sessions and retain `Me` and `Them` provenance.
- Committed live text never changes. The newest uncommitted tail may be replaced as EOU refines it.
- Live text is a preview, not canonical evidence. The existing sealed dual-source Parakeet finalization, integrity validation, and generation-guarded commit remain unchanged.
- Recording readiness requires the pinned EOU model and native runtime. A missing or invalid model blocks start instead of silently switching engines.
- A mid-recording EOU failure never interrupts raw capture or journal sealing and never starts MLX. Pluto shows a calm live-unavailable state until finalization.

## Selected architecture

### Causal audio path

Keep the current microphone and AudioCap capture paths. Both already expose raw `Float32` PCM before five-second durable receipts are packaged. Add a pure per-source chunker that groups those samples into 320 ms advances while preserving source sample rate and exact frame order.

The renderer sends bounded typed PCM frames to the Electron main process. Main converts the frame bytes to base64 only at the JSON-lines boundary and forwards them to the exclusive native Parakeet runtime. The native runtime validates byte count, frame count, source, generation, and sequence before constructing an `AVAudioPCMBuffer`. FluidAudio performs the final mono/16 kHz conversion expected by EOU.

Five-second receipt WAVs remain capture and recovery authority but are not the live input. Feeding receipt files would make the first result inherently non-live. Moving capture into Swift would unnecessarily replace a proven durability boundary.

### Native EOU sessions

Add an explicit EOU protocol rather than overloading the existing sliding-window shadow commands:

- `eou_open`: create one source session for a recording generation.
- `eou_append`: admit one causal PCM frame with a strictly increasing sequence and audio interval.
- `eou_finish`: drain and pad the final tail, emit the last update, and destroy the session.
- `eou_cancel`: terminate without a final live update.
- `eou_reset`: destroy stale state before a new generation.

Each request is bounded to at most two seconds of mono Float32 audio and must declare matching `frameCount`, `sampleRate`, `channelCount`, source, stream id, generation, sequence, and start/end boundaries. Duplicates, gaps, invalid base64, non-finite samples, oversized payloads, and out-of-order frames fail with content-free stable codes. Recognized text and audio bytes never enter logs.

One `StreamingEouAsrManager` in `.ms320` mode belongs to each source. Managers never share decoder state. The existing native runtime host's exclusive live lease and final-preemption rules remain authoritative.

### Live update contract

The native runtime emits explicit `eou_update` events with source, stream id, generation, event revision, processed-audio watermark, committed text, tentative text, and timed token/EOU boundaries.

FluidAudio's partial callback reports the accumulated hypothesis. Its EOU callback marks the accumulated hypothesis as committed. Pluto stores that snapshot as the immutable committed prefix and exposes only its later suffix as tentative. If a later hypothesis does not begin with the committed lexical prefix after whitespace normalization, the source fails instead of rewriting committed text.

Electron fences every update by recording id, stream id, source, generation, and increasing event revision. Late or duplicate events are ignored. Timed committed spans become stable `LiveTranscriptSegment` rows; the current tentative span remains replaceable. Source determines `Me` or `Them`, and audio boundaries determine inter-source ordering.

### Lifecycle and backpressure

Before capture starts, main process readiness verifies the active model bundle, starts the native runtime, and opens both source sessions. No microphone or System resource is acquired until that succeeds.

Each source has a bounded sequential append queue. The renderer aggregates at 320 ms cadence; Electron permits a small fixed number of frames in flight and fails the live epoch instead of dropping or reordering audio. Capture callbacks never wait synchronously on recognition.

On stop, Pluto stops accepting new frames, flushes each chunker's partial tail, drains admitted appends, finishes both EOU managers, fences later events, and releases the live lease. Canonical finalization then uses the existing sealed artifacts. On renderer loss, cancellation, native exit, sequence failure, or queue overflow, both live sessions are cancelled once while capture ownership and journaling continue normally.

## Model lifecycle

Extend the atomic production model bundle to include only the 320 ms assets from `FluidInference/parakeet-realtime-eou-120m-coreml`: `streaming_encoder.mlmodelc`, `decoder.mlmodelc`, `joint_decision.mlmodelc`, and `vocab.json` under `parakeet-eou-streaming/320ms`.

Pin the repository revision and calculated artifact digest in source alongside the existing Parakeet manifests. Installation occurs in staging, verifies the remote revision and all artifact digests, and activates one complete bundle atomically. Recording readiness requires both final and EOU assets. Missing, partial, unverified, or stale EOU assets cannot be treated as ready.

Packaging includes the runtime capability and installer metadata, not pre-downloaded user model weights. Existing privacy constraints remain: recognition is local and model acquisition is the only network operation.

## Existing paths changed

- Replace `mlxAvailable` recording-readiness semantics with explicit EOU readiness while leaving unrelated speaker-attribution readiness alone.
- Replace the `LiveTranscriptionQueue` invocation in active recording with the EOU coordinator. No MLX preview client call remains reachable from recording.
- Preserve current live-transcript presentation, follow behavior, source labels, and exact-text disclosure, but feed it EOU committed/tentative projections.
- Keep the existing shadow/sliding-window code isolated for historical benchmarks until the later MLX/remnant cleanup phase; it is not the visible engine.
- Keep final batch Parakeet, capture journals, reconciliation, transcript integrity, and analysis sequencing unchanged.

## Failure semantics

| Boundary | Behavior |
| --- | --- |
| EOU model/runtime unavailable before start | Block recording with a finite local-transcription readiness reason. |
| One source cannot open | Close the other source and block recording. |
| Invalid/out-of-order/overflow append | Cancel both EOU sessions, keep capture running, show live unavailable. |
| Native runtime exits mid-recording | Keep capture/journals running; do not restart MLX or revise committed text. |
| Stop with a short tail | Pad/process it through `finish`; an empty tail succeeds without invented text. |
| Final Parakeet failure | Use the existing recovery-required/retry contract; live preview is never promoted to canonical. |

## Verification gates

Promotion is complete only when all of these hold:

1. Native unit tests cover model integrity, strict PCM decoding, source/generation/sequence ordering, EOU/partial projection, silence, short-tail finish, cancellation, reset, stale events, and cleanup.
2. TypeScript tests cover 320 ms chunking at observed mic/System rates, bounded queues, dual-source ordering, stable committed prefixes, tentative replacement, startup blocking, mid-record failure, stop drain, renderer loss, and proof that recording never invokes MLX.
3. A private causal replay feeds real PCM in real-time order—not completed WAV files—and records content-free latency, queue, thermal, memory, and continuity metrics.
4. A real Electron recording proves both sources can publish visible live text, a native failure leaves capture sealable, and the persisted/reloaded final transcript still comes only from canonical Parakeet finalization.
5. Packaging from a clean install downloads and verifies the pinned EOU assets and reports ready without an MLX health check.

## Deferred removal

After EOU passes the gates and real use is satisfactory, a separate issue will remove MLX transcription source, settings, IPC, Python/runtime dependencies, packaging, migrations, and obsolete shadow/fallback types. Keeping that deletion separate makes this promotion reversible without allowing MLX to operate as a hidden backup.

