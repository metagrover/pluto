# Quality-First Parakeet Final Transcription Design

**Issue:** [#441](https://github.com/metagrover/pluto/issues/441)

**Status:** Approved by the owner on 2026-08-15

## Outcome

Pluto keeps responsive local live text while producing a more accurate, complete, and memory-safe final transcript before meeting analysis begins. Five-second MLX Whisper base-model chunks remain the live-preview recognizer. A Pluto-owned FluidAudio/Parakeet TDT 0.6B v3 Core ML runtime becomes the required final-validation recognizer on Apple Silicon.

The final pass transcribes the microphone and system sources independently, preserves their source provenance, removes cross-channel bleed and overlapping hypotheses, validates the result against sealed capture evidence, commits one canonical transcript, and only then releases analysis. A recognizer failure never changes durable capture truth or silently validates a lower-quality transcript.

## Product rules

1. Live preview and final validation are separate policies with separate engines and quality contracts.
2. Final transcript quality and completeness outrank download size and finalization latency.
3. The provisional checkpoint transcript remains visible while final validation runs.
4. Analysis, entities, MID generation, and knowledge synthesis consume only the committed final-validation transcript.
5. Whole-meeting MLX is not a fallback. The observed unified-memory freezes make it ineligible for unbounded final recognition.
6. Failure preserves the provisional transcript and sealed recording, moves the transcript to a retryable `needs_attention` state, and exposes a content-free reason.
7. Real meeting audio, transcript text, identities, paths, and model output remain local and never enter committed fixtures or diagnostics.

## Considered approaches

### Persistent native FluidAudio service (selected)

Build a Pluto-owned Swift executable linked against a pinned FluidAudio release. Electron starts it on demand, communicates through newline-delimited JSON over standard input/output, and keeps the model loaded across sequential requests. This provides a narrow process boundary, bounded Core ML memory, cancellation, deterministic version metadata, and no Python-to-Swift shell parsing.

### Invoke the FluidAudio CLI per request (rejected)

This would accelerate a prototype but make production behavior depend on CLI log formatting, repeat model initialization, weaken cancellation, and leave model ownership implicit. It is not an acceptable long-term application boundary.

### Replace live and final MLX with Parakeet (deferred)

FluidAudio supports streaming, but Pluto has not measured its first-text latency, update cadence, thermal admission, checkpoint replacement, or stop behavior. Replacing both paths would combine two product changes and risk the proven live-preview contract. A future policy may promote Parakeet streaming only after issue #443 evidence supports it.

## Architecture

### Policy roles

Pluto defines two provider-neutral roles:

```ts
type TranscriptionPolicyRole = 'live_preview' | 'final_validation';
type TranscriptionEngine = 'mlx_whisper' | 'parakeet_coreml';
```

The shipped Apple Silicon policy is fixed and observable:

| Role | Engine | Model | Source unit | Concurrency |
| --- | --- | --- | --- | --- |
| `live_preview` | `mlx_whisper` | `base` | sealed five-second source chunk | live queue policy |
| `final_validation` | `parakeet_coreml` | Parakeet TDT 0.6B v3 int8 | complete mic/system source | one request at a time |

Language remains explicit. Known-person vocabulary is resolved once per meeting and supplied as bounded terms for acoustically gated rescoring. Device and compute-type choices are implementation metadata, not user-facing settings.

### Provider-neutral Electron boundary

`electron/transcription/` owns provider selection and normalized result contracts:

- `contracts.ts` defines requests, words, segments, VAD evidence, health, model readiness, and content-free metadata.
- `policy.ts` resolves the fixed live/final policy and rejects unsupported runtime combinations.
- `mlxPreviewClient.ts` owns the existing Python HTTP lifecycle for live chunks, recovery chunks, aligned energy, and sherpa-onnx attribution.
- `parakeetFinalClient.ts` owns the Swift process lifecycle, request correlation, cancellation, timeouts, and sanitized errors.
- `index.ts` routes requests by policy role and returns one normalized `TranscriptionResult`.

Renderer code invokes `TRANSCRIPTION_TRANSCRIBE` with a policy role. It does not select a provider, device, or compute type. Existing `WHISPER_*` IPC channels and WhisperX compatibility names are removed after all callers migrate.

### Native Parakeet service

`native/parakeet-runtime/` is a Swift Package Manager executable pinned to FluidAudio 0.15.5. The release executable is copied to `resources/bin/parakeet-runtime`, signed with the application build, and included through the existing `extraResources` contract.

The service accepts JSON lines:

```json
{"id":"opaque-request-id","method":"prepare","modelRoot":"approved-root"}
{"id":"opaque-request-id","method":"transcribe","audioPath":"approved-path","language":"en","vocabulary":["bounded term"]}
{"id":"opaque-request-id","method":"cancel","targetId":"opaque-request-id"}
{"id":"opaque-request-id","method":"shutdown"}
```

Responses contain only the request id, success/failure, stable reason code, model metadata, VAD status, confidence aggregates, duration, processing time, and word timings. Native logs never print audio paths, vocabulary terms, transcript text, or raw exception chains.

The runtime:

1. Validates that model and audio paths are absolute descendants of Electron-supplied approved roots.
2. Downloads/loads Parakeet v3 into a Pluto-owned model root rather than FluidAudio's shared application cache.
3. Uses Core ML CPU plus Neural Engine configuration and FluidAudio's disk-backed long-form path.
4. Serializes ASR requests so two full sources cannot load or decode concurrently.
5. Creates a fresh `TdtDecoderState` for every source while reusing immutable loaded models.
6. Returns token/word timings and acoustic confidence; text segmentation remains a provider-neutral TypeScript responsibility.
7. Cancels meeting-scoped work without terminating durable capture or another meeting's completed result.

### Managed model lifecycle

Pluto owns `userData/models/transcription/parakeet-v3/`. A checked-in manifest pins:

- FluidAudio package version and revision;
- model family, model version, encoder precision, provider repository, and license identifiers;
- required model/vocabulary artifacts and expected installed layout;
- a manifest schema version and Pluto bundle version.

Preparation downloads into `staging/`, validates the expected layout, proves every Core ML bundle loads, writes sanitized bundle metadata, and atomically activates an immutable version directory. An interrupted or failed preparation does not replace an active version. A deterministic silence/speech probe proves load and inference compatibility; it is not presented as an accuracy benchmark.

The first implementation may use FluidAudio's transport internally, but activation and readiness are Pluto-owned. No runtime lookup reads Hex or another application's model directory. Model status is content-free and retryable.

### Word normalization and segmentation

`src/services/finalTranscription/segmentParakeetWords.ts` converts normalized word timings into transcript segments without rewriting recognized words. A boundary occurs at the earliest of:

- terminal punctuation followed by a word;
- a silence gap of at least 800 ms;
- 15 seconds of segment duration;
- 40 words.

Segments retain the exact ordered words and timing envelope. Empty output is accepted only with explicit no-speech evidence. Out-of-order, negative, non-finite, beyond-duration, or heavily overlapping timings fail closed.

### Final-validation workflow

`src/services/finalTranscription/runFinalTranscription.ts` is independent of `AudioManager.tsx` and receives sealed meeting evidence plus injected operations.

1. Claim one meeting-scoped final-validation lease.
2. Confirm the capture journal is sealed and resolve immutable mic/system artifacts.
3. Prepare the Parakeet runtime if necessary.
4. Transcribe mic, then system, never concurrently.
5. Skip a missing source only when sealed evidence records `source_unavailable`.
6. Convert word timings to source-owned `Me` and `Them` segments.
7. Reconcile the two streams using the existing transcript-integrity and attribution utilities, with source transcripts retained as coverage proof.
8. Reject cross-channel bleed, overlapping duplicate hypotheses, invalid timing, unexplained required-source activity, or a failed/no-proof empty result.
9. Commit the canonical transcript and validation metadata conditionally against the lease and journal generation.
10. Release the existing downstream worker only after the canonical commit succeeds.

Mixed audio is not transcribed when both channel sources exist. It is eligible only for a legacy meeting that lacks channel-separated evidence, and such a result remains `needs_attention` unless the existing integrity contract can prove required source coverage.

### Scheduling and resource policy

Final validation runs after capture sealing and outside the recording critical path. The app-wide post-meeting worker owns it, not the renderer component lifecycle. Requests are sequential across meetings and yield to an active capture lease. Before starting, the worker checks the existing macOS power/thermal policy and requires acceptable memory pressure. Denial leaves the lease retryable; it does not select MLX.

The deadline is bounded by a fixed startup allowance plus recording duration. Cancellation, app shutdown, lease supersession, or a new active capture aborts the request. The Swift service may remain warm while useful, but unloads after the configured idle period or explicit memory pressure.

## Persistence

The canonical transcript payload records:

- `pipelineMode: "parakeet_final_v1"`;
- `canonicalSource: "recovered_channels"`;
- policy role and engine;
- FluidAudio version, Parakeet bundle version, model version, precision, and language;
- per-source outcome, word count, confidence aggregate, elapsed time, and VAD status;
- vocabulary policy version/count without vocabulary content;
- validation proof bound to capture-journal generation and source checksums;
- live responsiveness and stop-to-validated latency summaries.

Diagnostics and GitHub evidence contain aggregates only. Transcript bytes remain in the existing canonical transcript field and are protected by conditional persistence.

## Failure semantics

- **Model unavailable/download interrupted:** keep the provisional transcript, persist `parakeet_model_unavailable`, and retry.
- **Native runtime exits:** reject every pending request with `parakeet_runtime_exited`; restart only on a later bounded retry.
- **Invalid native response:** fail closed as `parakeet_protocol_invalid` without exposing raw output.
- **Timeout/cancellation:** terminate the request, persist a stable retry reason, and leave the prior transcript generation authoritative.
- **No speech:** accept only an explicit VAD `no_speech` outcome with source-duration proof.
- **Integrity failure:** persist `needs_attention` with finite cause codes; do not launch analysis.
- **Conditional-save conflict:** discard the late result as superseded.
- **Parakeet unavailable:** do not run whole-session MLX or silently validate checkpoint text.

## Stale-code removal

The cutover removes only code made obsolete by the new boundary:

- disabled whole-session MLX fallback/hydration branches in `AudioManager.tsx`;
- `WHISPER_TRANSCRIBE`, `WHISPER_LIST_BACKENDS`, and historical WhisperX manager aliases after caller migration;
- legacy `whisperx_current`, `whisperx_tuned`, CPU, CUDA, MPS, and compute-type settings;
- `local_alt_apple_silicon` as a persisted engine identity;
- settings controls whose values are silently ignored or coerced;
- benchmark labels and documentation that claim MLX is the only transcription engine.

Sherpa-onnx attribution, aligned-energy evidence, capture-journal recovery, MLX live chunks, and their tested trust boundaries remain. Large unrelated refactors are excluded.

## Testing

### Native tests

- JSON protocol decoding/encoding and content-free error mapping;
- approved-root path validation;
- model readiness/activation state transitions;
- fresh decoder state per request and serialized execution;
- cancellation and graceful shutdown;
- synthetic speech/no-speech transcription using the actual runtime where hardware permits;
- constant-memory long-form behavior reported as a manual hardware gate.

### TypeScript unit and integration tests

- fixed policy resolution and unsupported-platform behavior;
- Parakeet client lifecycle, request correlation, timeout, cancellation, exit, and malformed responses;
- word timing validation and deterministic segmentation;
- sequential mic/system invocation and no mixed-source invocation when channels exist;
- explicit no-speech handling and failed empty output;
- source reconciliation, bleed collapse, overlapping hypothesis removal, and integrity rejection;
- conditional canonical commit before downstream processing;
- restart/supersession behavior and content-free metadata.

### Benchmark and application gates

- Extend issue #443's committed synthetic corpus with final-policy, provider-readiness, failure, silence, overlap, and analysis-handoff fixtures.
- Add a local-only manifest format for human-reviewed real meeting excerpts; no text or audio is committed.
- Score WER, missing-speech duration, hallucinated words in silence, vocabulary precision/recall, channel attribution, duplicate rate, timestamp validity, peak RSS, and elapsed time.
- A policy change fails if it regresses an approved stable accuracy metric. Hardware metrics remain reported separately.
- Run the complete unit suite, recording-quality benchmark, native build/tests, type check/build, lint, changelog check, and high-severity audit.
- In the packaged app, record a real meeting, confirm responsive live text, provisional visibility, post-stop Parakeet validation, canonical replacement, correct transcript status, and analysis grounded in the exact committed final transcript.

## Delivery sequence

1. Add the native runtime, model contract, and Electron client without changing the default policy.
2. Add provider-neutral policy contracts and final-validation orchestration with synthetic tests.
3. Switch canonical final validation and analysis handoff to Parakeet.
4. Remove obsolete WhisperX/backend/settings and dead final-ASR code.
5. Extend benchmarks, record the durable architecture decision, update documentation/changelog, and perform packaged workflow validation.

Each step is independently testable, but issue #441 is not complete until the cutover, cleanup, quality gates, and end-to-end workflow evidence all pass.
