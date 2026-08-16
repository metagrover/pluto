# Parakeet Live Transcription Design

**Issue:** #630  
**Depends on:** #441 / PR #628, #629  
**Status:** Approved direction; feasibility-gated implementation

## Outcome

On supported Apple Silicon, Pluto should use the pinned FluidAudio Parakeet TDT v3 model as the primary live recognizer when it can do so without weakening capture durability, transcript continuity, privacy, or final canonical integrity. The long-term path is one continuous ASR session followed by a final stream flush and targeted gap repair, rather than separate live MLX and whole-session Parakeet passes.

MLX remains a one-way startup or failure fallback until the live Parakeet gate passes. Analysis remains post-meeting and starts only after the exact canonical transcript commits.

## Corrected technical premise

FluidAudio 0.15.5 TDT v3 is pseudo-streaming, not a native streaming encoder. `SlidingWindowAsrManager` reruns the offline encoder over overlapping windows while preserving TDT predictor/decoder state and deduplicating tokens.

The pinned `.streaming` preset does not currently produce one-second hypotheses. It waits for an 11-second center plus two seconds of right context, so its first normal update is approximately 13 seconds. `hypothesisChunkSeconds` is declared but unused by the processing loop. A custom two-second center with two seconds of right context could theoretically publish after four seconds, but its quality and resource behavior must be measured rather than assumed.

FluidAudio's `isConfirmed` update also does not mean the current update text is confirmed. A qualifying update promotes the previous volatile text and installs the current update as the new volatile tail. Pluto must adapt this into an explicit `committedPreviewDelta` plus `tentativeReplacement` contract.

## Alternatives

### A. Replace MLX immediately

Adopt custom two-second Parakeet windows directly in the recording path and keep batch finalization as fallback.

Rejected because the pinned API has unbounded input buffering, incomplete failure visibility, ambiguous confirmation semantics, content-bearing debug logs, unproven dual-stream Core ML behavior, and no live AEC residual contract.

### B. Production-shaped shadow evaluation, then promotion

Build the native streaming protocol, stable-prefix adapter, Electron client, and causal replay benchmark first. Evaluate pinned default and custom low-latency configurations against production MLX. Promote the same adapter into recording only when the gate passes.

Selected because it tests the real implementation boundary while preserving current recording behavior until continuity and resource claims are demonstrated.

### C. Switch to Parakeet EOU

Use FluidAudio's smaller true-streaming Parakeet EOU model.

Deferred because it is English-only and changes the quality/model decision already made under #441. It remains a future comparison if TDT pseudo-streaming cannot meet the live gate.

## Delivery decomposition

### Phase A: Feasibility stack

This issue's first PR stack builds reusable production seams without changing the user-visible live engine:

1. A pure stable-prefix reducer and content-free live metrics.
2. Additive native stream commands and typed events.
3. A Pluto-owned FluidAudio live session using the verified model container.
4. A bounded Electron live client with strict sequence and generation fencing.
5. A local-only causal MLX-versus-Parakeet replay and one-timescale soak.
6. A decision report that either approves promotion or records the exact failing gates.

### Phase B: Recording integration

This begins only if Phase A passes:

1. Electron owns a per-meeting live coordinator.
2. Capture-journal receipts feed a durable per-source FIFO; the existing latest-wins preview queue is not reused for primary evidence.
3. System-referenced AEC-derived mic intervals from #629 feed the mic stream. Raw mic and System capture remain immutable authority.
4. Parakeet tentative and committed-preview updates drive the existing continuous transcript presentation.
5. A one-way MLX fallback preserves the Parakeet committed prefix and starts a new engine epoch.
6. Stop drains durable appends, flushes both streams, persists coverage proof, repairs bounded gaps, and uses whole-session Parakeet only as a guarded fallback for broad or untrusted coverage.

## Native runtime contract

The JSON-lines protocol remains additive at schema version 1 so existing final transcription is unchanged.

Commands:

- `stream_open`: create a one-meeting, one-source generation using the verified active model bundle.
- `stream_append`: admit one approved WAV path with strict `generation`, `source`, and `sequence` ordering.
- `stream_flush`: finish input, process the partial tail, return a final preview and degradation summary, then destroy the manager.
- `stream_cancel`: terminate without a final transcript and destroy the manager.
- `stream_reset`: cancel and recreate under a new generation; FluidAudio managers cannot restart after their immutable input stream is finished.

Events:

- `stream_update`: `streamId`, source, generation, event sequence, committed-preview delta, tentative replacement, confidence, and processed-audio boundary.
- `stream_degraded`: a finite reason code and affected sequence/range only.
- `stream_failed`: a finite terminal reason code only.

Audio remains path-based. Pluto feeds already converted, approved WAV chunks rather than base64 PCM over JSON. Every append is receipt-bound and idempotent by source, generation, sequence, and checksum. Duplicate append is accepted only when identity matches; gaps and out-of-order input fail or reset explicitly and never compress the audio timeline silently.

The runtime owns bounded append admission. It cannot depend on FluidAudio's unbounded `AsyncStream` as the queue. The update consumer starts before the first append. Recognized text and vocabulary replacements must not be written to logs.

## Stable-prefix contract

Each source has:

- an immutable committed-preview prefix;
- one replaceable tentative tail;
- an engine epoch and native generation;
- a strictly increasing event revision;
- a processed-audio watermark.

When FluidAudio reports a qualifying update, Pluto promotes the prior tentative tail and installs the current update as tentative. No committed-preview token or stable segment ID may later change. `committed-preview` deliberately avoids the words `validated` and `canonical`; FluidAudio partial-window failure visibility and structured final timings are not sufficient for those claims.

Late events from a prior generation, epoch, meeting, or revision are ignored. Punctuation and whitespace changes are normalized without rewriting committed lexical tokens.

## Capture and fallback state machine

```text
idle
  -> preparing_parakeet
       -> parakeet_shadow or parakeet_primary
       -> mlx_fallback

parakeet_primary
  -> streaming
       update -> replace tentative tail or extend committed-preview prefix
       runtime/AEC/admission failure -> mlx_fallback for unresolved/future audio

mlx_fallback
  -> streaming
       preserve prior Parakeet committed-preview prefix
       publish MLX under a new engine epoch
       do not switch back in the same meeting

recording stop
  -> drain durable append FIFO
  -> flush Parakeet tail
  -> stop and seal capture journal
  -> compare stream coverage with sealed evidence
       complete/trusted -> canonical reconciliation and commit
       bounded gaps -> targeted repair and commit
       broad/untrusted -> guarded whole-session fallback
       capture failure -> recovery_required

canonical commit
  -> validated
  -> downstream analysis and knowledge processing
```

Normal stop flush is distinct from cancellation. Cancellation may not preempt the last accepted append or normal final tail flush.

## AEC dependency

#629 currently describes offline AEC after sealing; #630 ultimately requires synchronized streaming AEC before mic ASR. Until that contract exists:

- clean System may be evaluated and shadow-transcribed live;
- raw mic output remains diagnostic/tentative and cannot establish `Me`;
- the Parakeet-primary migration gate reports `dependency_unavailable` rather than pretending raw mic is independent local evidence.

Each AEC-derived interval must bind to immutable raw receipts and record algorithm version, reference coverage, delay/drift state, residual confidence, and checksum. Missing, weak, clipped, or low-confidence reference evidence fails closed.

## Finalization without routine batch ASR

The finalizer reconstructs trust from sealed journal evidence, never solely from renderer memory. Per source it persists accepted sequence ranges, processed ranges, committed-preview boundary, failed windows, unresolved tentative range, AEC evidence, engine epochs, and configuration digest.

After flush it computes gaps caused by missing sequences, failed windows, unresolved tails, weak AEC, or fallback boundaries. A bounded gap is transcribed with at most two seconds of context on each side and spliced by deterministic timing/token reconciliation. Broad gaps retain the current whole-session Parakeet path as guarded fallback until equivalence is proven.

Batch Parakeet is a consistency oracle, not ground truth. Agreement can catch broken streaming assembly; it cannot prove that shared model output is linguistically correct.

## Causal evaluation

The private runner selects at least three recent meetings totaling at least 90 minutes, including one meeting of at least 30 minutes. Each meeting must have sealed, gap-free, independent mic and System artifacts aligned within five seconds of the meeting duration.

Audio is released on a virtual causal clock in 250 ms frames. Neither engine may observe future samples. MLX uses its production five-second paired-chunk queue behavior. Parakeet uses the production-shaped live client and two source streams sharing the verified model bundle. Three warm repetitions alternate engine order. The longest meeting also runs once at real-time speed for thermal and memory evidence.

The report serializes allowlisted numeric aggregates, booleans, public version pins, enum reasons, and verdicts only. It must not contain transcript/token strings, per-meeting objects, exact durations, timestamps, hashes, audio, paths, identities, IDs, stderr, or arbitrary exception messages.

## Promotion gates

Zero-tolerance invariants:

- committed-preview prefix edits or deletions: zero;
- missing accepted input sequence: zero;
- overlapping duplicate token provenance: zero;
- sealed source coverage: exactly 1.0000;
- unexpected private/text/path report fields: zero;
- whole-session ASR calls when streaming coverage is complete: zero;
- analysis before canonical commit: zero.

Initial quantitative gates:

- first text: p50 at most 5 seconds, p95 at most 8 seconds, maximum 12 seconds, and Parakeet p95 no more than MLX plus one second;
- active-speech publication cadence: median at most 3 seconds, p95 at most 5 seconds, maximum 8 seconds;
- post-lookahead processing latency: p95 at most 2 seconds, maximum 5 seconds;
- RTF: at most 0.50 per source and no worse than 1.20 times MLX;
- capture-side handoff: p99 at most 10 ms with no inference on the renderer callback;
- peak child RSS: at most 2.5 GiB and at most 1.5 GiB above prepared idle;
- steady memory growth after warmup: at most 64 MiB/hour;
- thermal: no serious/critical samples; fair at most 10% and never continuously over five minutes;
- volatile revision operations per new token: at most 0.15; p95 rollback at most three tokens; no revision older than six seconds;
- seam duplicate and omission rate: at most 0.5%, with zero on committed synthetic cases;
- streaming-versus-batch diagnostic edit rate: at most 0.10 and time-aligned precision/recall at least 0.90 at two seconds and 0.95 at five seconds;
- causal proxy non-regression: Parakeet disagreement no more than MLX plus 0.02 and aligned recall no more than 0.02 below MLX;
- targeted repair: exact gap detected, at most two seconds context per side, no token outside repair context changes, repaired-region token F1 at least 0.98.

Distributional limits use bootstrap 95% bounds. Zero-tolerance invariants hold in every repetition. Insufficient corpus, unavailable AEC evidence, or missing resource evidence cannot produce PASS.

## Privacy and diagnostics

Runtime logs, benchmark output, committed fixtures, GitHub, and changelog entries remain content-free. The native dependency must be configured or patched so its recognized-text debug statements do not reach Pluto logs. Error surfaces use finite allowlisted codes.

## Testing

- Swift protocol and registry tests: start, strict append ordering, duplicate identity, gap, update, degradation, flush tail, cancel, reset-by-recreate, shutdown, and approved paths.
- Swift integration tests: shared models with isolated mic/System decoder state, serialized versus concurrent determinism, short-tail flush, partial-window degradation, and long-stream backlog bounds.
- TypeScript reducer tests: prior tentative promotion, monotonic prefix, stable IDs, Unicode/punctuation, dual-source interleaving, and stale epoch/generation events.
- Electron client tests: event/response interleaving, malformed and oversized lines, bounded admission, cancellation, failure, and no late event publication.
- Replay tests: causal availability, MLX production queue parity, percentiles/confidence bounds, sanitizer, gap injection/repair, and batch-as-diagnostic labeling.
- Later recording tests: journal proof binding, stop/append/flush/seal ordering, one-way fallback, presentation stability, and downstream gating.

## Non-goals

- Treating pseudo-streaming TDT as true encoder-state streaming.
- Claiming lexical accuracy improvement without independent ground truth.
- Adopting Parakeet EOU in this slice.
- Trusting raw mic channel identity as local speaker identity.
- Removing current MLX or whole-session Parakeet fallback before gates pass.
- Starting analysis from tentative or committed-preview text.

