# Dual-Channel Parakeet Shadow Trial

**Issue:** #630  
**Status:** Approved for a guarded sample; implementation remains gated  
**Depends on:** #441 final-transcription runtime and #629 mic-source evidence work

## Outcome

Test whether Parakeet can process the complete live recording input during a
meeting without weakening recording. The trial processes both immutable
microphone and System sources. It does not change the live transcript, the
canonical transcript, or downstream analysis.

The trial is a feasibility gate, not a real-time-engine promotion. A passing
sample proves that the workflow can run on the owner's machine; repeated
causal replay and soak evidence remain required before Parakeet can replace
MLX for visible live text or routine finalization.

## Scope and non-goals

In scope:

- Existing five-second sealed capture-journal receipts from both sources.
- Non-overlapping thirty-second logical windows assembled per source from
  those receipts.
- Background Parakeet recognition for each source, receipt-bound provisional
  output, stop-tail flush, resource admission, cancellation, and a
  content-free local report.
- The existing timing, source-coverage, and reconciliation checks used only
  to assess the sample.

Out of scope:

- Publishing Parakeet text in the live UI.
- Replacing the MLX preview or the existing whole-recording Parakeet final
  validation.
- Starting notes, search, or analysis from shadow output.
- Treating raw microphone output as trustworthy local-speaker identity before
  #629 supplies the required echo/reference evidence.
- Uploading or committing audio, transcript text, identities, IDs, paths, or
  detailed timing records.

## Design

### Receipt-to-window assembly

The coordinator consumes only durable, checksum-verified receipts. It keeps
one ordered assembler for `mic` and one for `system`. A logical window spans
`[0, 30)`, `[30, 60)`, and so on, with every admitted receipt assigned to
exactly one source window. The coordinator does not manufacture silence,
skip sequence numbers, combine sources, or send unsealed audio.

A full window becomes eligible after all its covered receipts are durable.
The final, shorter window becomes eligible only during normal stop after the
capture journal has accepted its final receipt. A receipt gap, checksum
mismatch, conversion failure, out-of-order append, or resource denial marks
the affected range explicitly unresolved rather than guessing a result.

### Background processing

The trial opens independent Parakeet work for mic and System windows, while
retaining a bounded, receipt-ordered queue. It must never run recognition on
the renderer callback or block audio capture. Existing MLX preview remains
the sole source of visible live text.

Each successful result is retained as provisional, bound to meeting,
generation, source, window interval, receipt sequence range, configuration
digest, and bounded outcome metadata. The application does not render or
consume its recognized words outside the owner-only trial evaluator.

Both sources are required inputs to the trial. Their results are kept
separate and passed through the existing timestamp-aligned reconciliation
only after stop for evaluation. This permits a complete dual-source test
without overclaiming that raw microphone recognition establishes `Me` during
echo or overlap.

### Stop, failure, and recovery

On a normal stop, Pluto drains only already-durable window work, creates the
final partial window, and waits for its bounded Parakeet flush. It compares
the attempted and completed source ranges with sealed receipt coverage.

If Parakeet is unavailable, falls behind, exceeds the memory/thermal policy,
or receives malformed input, the coordinator fences and cancels shadow work.
The recording, MLX live preview, journal, standard post-recording Parakeet
validation, and retry behavior continue unchanged. Shadow failure is
content-free and retryable; it cannot lower the trust state of a captured
meeting or overwrite established canonical output.

## Success criteria

The sample is successful only when all of these hold:

1. Both mic and System receipt ledgers account for every sealed interval:
   each is processed once or has a finite, explicit unresolved reason.
2. Capture integrity does not regress: no lost capture receipt, journal
   corruption, renderer-blocking inference, or MLX preview starvation.
3. The stop tail is accounted for; no window boundary produces an unexplained
   duplicate, omission, or out-of-bounds timed segment.
4. Resource samples remain within the existing recording safety policy. Any
   policy breach cancels shadow work cleanly rather than competing with
   recording.
5. Timestamp-aligned dual-source reconciliation completes as an evaluation
   artifact and preserves its existing integrity checks.
6. No provisional output reaches the live transcript, canonical commit,
   notes, search, or analysis.
7. The local report contains allowlisted aggregate counts, durations buckets,
   resource summaries, finite reason codes, and pass/fail verdicts only.

Failure of any criterion produces an investigation result, not a promotion.
The result must identify the failed gate without exposing meeting content.

## Promotion path

After the sample, run the existing causal replay and real-time soak gates on
multiple representative sealed meetings. Promotion requires complete source
coverage, stable boundaries, safe memory and thermal behavior, failure
containment, and no regression against MLX. A separate reviewed design then
decides whether and how provisional Parakeet output replaces visible MLX
text. That later change is intentionally not authorized by this trial.

## Test plan

- Unit: receipt-to-window assignment, exact-once source coverage, partial
  tail, sequence gaps, and no cross-source mixing.
- Unit: admission/fencing behavior and content-free diagnostic serialization.
- Integration: ordered dual-source append, normal stop/flush, cancellation,
  resource-policy rejection, and late-event suppression.
- Guarded local sample: one consenting owner recording, with content-free
  measurements only.
- Regression: the ordinary recording and finalization suite continues to use
  MLX preview plus the existing final canonical path unchanged.
