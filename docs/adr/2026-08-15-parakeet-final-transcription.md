# ADR: Use Parakeet Core ML for canonical final transcription

- **Status:** Accepted
- **Date:** 2026-08-15
- **Issue:** [#441](https://github.com/metagrover/pluto/issues/441)

## Context

MLX Whisper base is responsive enough for Pluto's five-second live-preview chunks, but whole-meeting MLX recognition can consume unified memory without a safe process boundary. Two observed runs coincided with roughly 12 GB application memory and a frozen system. The final transcript also needs a stronger quality contract than the provisional preview.

## Decision

Pluto uses two explicit local policies on Apple Silicon:

- MLX Whisper base produces bounded live-preview chunks.
- A Pluto-owned Swift process using FluidAudio 0.15.5 and Parakeet TDT 0.6B v3 int8 produces the canonical final transcript.

The Parakeet process downloads reviewed model revisions into Pluto's model directory, verifies the complete staged ASR and vocabulary trees against shipped SHA-256 values before atomic activation, uses Core ML CPU plus Neural Engine, and transcribes complete microphone and system artifacts sequentially. Electron communicates over correlated JSON lines and may terminate the child independently. Pluto never uses whole-session MLX as fallback.

The provisional transcript remains durable until sealed evidence passes final validation. A generation-guarded commit replaces it atomically, and only the exact committed canonical transcript can start analysis. Runtime, model, timing, or integrity failures preserve the recording and provisional transcript in a retryable `needs_attention` state.

Before inference, Pluto admits final work only under acceptable thermal and memory pressure. Serious or critical thermal state, less than 1 GiB available memory, or less than 8% available system memory pauses the pass with a visible retryable reason. On macOS, the available-memory estimate uses `/usr/bin/memory_pressure -Q`; `os.freemem()` is only a fallback because it excludes healthy reclaimable cache and produced a false denial during the isolated application workflow. Battery power alone does not lower final quality. A completed request persists the real int8/Core ML compute contract, explicit language, warnings, aggregate and per-source elapsed time, provider/model bundle versions, VAD outcome, confidence, segment count, and word count. The native model process unloads after five idle minutes.

The recording component persists the provisional meeting and exits its critical path. The app-wide post-meeting coordinator reconstructs the sealed input, owns the final lease, and cancels plus unloads Parakeet when a new capture starts. Participant-specific vocabulary remains in a bounded in-memory handoff and is never persisted as provider metadata; restart recovery resolves the ordinary local known-person vocabulary. After commit, the downstream-only processor uses the exact canonical transcript for analysis, entity extraction, and knowledge synthesis without running transcription a second time.

## Consequences

The first preparation has a substantial local model download and setup cost. Finalization can take longer, but download size and latency are subordinate to quality and memory safety. Live and final provider identities are observable, private meeting content remains local, and real-meeting evaluation reports only aggregate accuracy, timing, and resource metrics.

Parakeet streaming is not adopted by this decision. It requires separate evidence for first-text latency, cadence, stop behavior, and thermal impact.

## Promotion gate

The expanded private replay used five recent meetings and ten source artifacts. One 53-minute source exposed 0.320 seconds of FluidAudio long-form chunk-boundary timing jitter, just beyond Pluto's original 0.250-second guard. Pluto now clamps bounded overlap through 0.500 seconds to a monotonic boundary and still rejects larger overlap. All ten recognition requests succeeded without timing failures, with a 0.0154 warm-model real-time factor and 499.8 MiB peak child RSS. A second clean-install replay exercised download, model compilation, full-tree checksum verification, and the same ten transcriptions; it peaked at 1075 MiB and the child exited after completion. Corrected source-duration probing then identified one historical system artifact that was 1189.299 seconds shorter than its meeting timeline, so the production integrity path correctly accepts four meetings and rejects that one rather than masking the mismatch. The existing transcript is not a valid ground truth: 112 segments were outside the authoritative audio duration, including one timeline that extended 679.63 seconds beyond its source, and one source disagreed with its proxy transcript's speech/no-speech claim. Exact time-aligned proxy precision/recall at ten seconds were 67.95%/79.16%; order-independent lexical precision/recall were 78.71%/85.99%. This proves operational and memory fit and exposes prior transcript-integrity defects, but still does not prove an accuracy improvement.

The evaluator can produce balanced blind A/B excerpts only when the persisted microphone source is distinct from the persisted mixed artifact, both source files independently match the meeting timeline, and the bounded excerpt contains recognized system speech. This distinction is mandatory: a historical repaired meeting stored its mixed artifact in both fields, so four of the owner's first eight ratings did not represent independent mic input and cannot support promotion. The four independently captured mic excerpts also showed strong short-delay System correlation, confirming unresolved acoustic echo tracked in #629. The reviewer export remains content-free and does not contain the candidate mapping; scoring requires the separately generated hidden assignment manifest and an exact review-id and case-set match. The submitted ratings are useful diagnostic evidence, but proxy disagreement and contaminated-input comparisons cannot establish an accuracy promotion.

The guarded service-workflow test opens the production meeting database read-only, selects a recent dual-source meeting with sealed activity and live-responsiveness evidence, and writes all lifecycle mutations to a process-unique test-owned database. With the real native runtime and managed model it proved provisional visibility, canonical replacement, validated status, completed downstream processing, and equality between the analysis-input SHA-256 and the exact committed canonical transcript. A literal Electron launch with observed live text remains a separate delivery gate. No transcript text, audio, path, identity, or digest value is emitted.
