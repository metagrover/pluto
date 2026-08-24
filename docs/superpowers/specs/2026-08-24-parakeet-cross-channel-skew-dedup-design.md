# Parakeet Cross-Channel Skew Deduplication Design

**Issue:** [#657](https://github.com/metagrover/pluto/issues/657)  
**Status:** Approved for implementation planning  
**Date:** 2026-08-24

## Problem

Parakeet finalization transcribes the sealed microphone and System artifacts independently, then reconciles them into one canonical transcript. The current word-level bleed collapse recognizes only matching words whose timestamps differ by at most 0.75 seconds. The strict segment resolver also requires substantial temporal overlap.

The latest persisted meeting proves that those assumptions are too narrow. Its canonical transcript contains 494 segments and reports 604.32 seconds of successfully collapsed pass-through, so the production reconciler did run. It still retained 16 clear multi-word exact or containment duplicate pairs. Fifteen miss the strict segment-overlap gate, and 40 of 41 high-confidence four-word anchors place the System copy 1.04 to 1.32 seconds after the microphone copy. The dominant offset is therefore stable evidence of cross-channel clock skew, not isolated lexical coincidence.

## Goals

- Collapse strongly evidenced cross-channel bleed when mic and System word clocks have a stable bounded offset.
- Preserve distinct simultaneous speech, intentional repetitions, short acknowledgements, and meetings without reliable skew evidence.
- Keep Parakeet finalization, sealed capture, integrity validation, and the generation-guarded canonical commit as the only production path.
- Persist content-free reconciliation provenance with the canonical transcript.
- Repair the affected meeting from its sealed capture without destroying the current transcript before the replacement passes validation.

## Non-goals

- Do not add acoustic echo cancellation, a derived residual audio source, or another transcription engine.
- Do not enable generic save-time linguistic cleanup for canonical transcripts.
- Do not rewrite provisional MLX preview chunks or Parakeet live-shadow output.
- Do not treat duplicate reduction as proof of transcription accuracy.

## Considered Approaches

### 1. Adaptive per-meeting skew calibration

Identify exact normalized word n-gram anchors shared by the mic and System results, derive a dominant bounded offset, and apply that offset only during the existing word-level bleed collapse.

This is the selected approach. It explains the observed recording, adapts to recordings whose clocks are already aligned, and requires meeting-level agreement before removing content.

### 2. Increase the global timing tolerance

Raise the existing 0.75-second tolerance to approximately 1.5 seconds.

This is smaller, but it treats all close speech as clock skew and makes legitimate rapid repetition easier to erase. It is rejected.

### 3. Run generic transcript cleanup after canonical save

Invoke `cleanTranscriptSegments` after every final commit.

This catches more repetition but broadly rewrites saved evidence and conflicts with Pluto's explicit canonical-immutability decision. It is rejected.

## Design

### Skew estimation

Add a pure estimator beside `collapseCrossChannelWordBleed`:

1. Flatten timed mic and System words using the existing token normalizer.
2. Build candidate anchors from at least four consecutive exact normalized tokens.
3. Ignore anchors that are ambiguous because the same n-gram appears repeatedly in either source.
4. Accept only offsets within plus or minus 2.5 seconds.
5. Cluster offsets whose values are within 0.24 seconds. Require at least three non-overlapping anchors, and require the dominant cluster to contain at least 75% of accepted anchors.
6. Use the median of the dominant cluster as the meeting offset only when its absolute value is greater than the existing 0.75-second direct-match tolerance and no greater than 2.5 seconds. If consensus is weak, return no offset.

The estimator is content-free at its boundary: callers receive the offset, anchor count, and confidence, never anchor text.

### Bleed collapse

Keep the current zero-offset matching pass. When a reliable non-zero offset exists, compare mic word time against System word time adjusted by the estimated offset, retaining the existing exact consecutive-token requirement and timing tolerance. Only matching mic words are removed; the System words remain canonical.

This ordering preserves current behavior for aligned recordings and makes the adaptive pass an evidence-gated extension. The strict segment resolver still runs afterward as a separate safety net.

### Provenance

Canonical Parakeet metadata records a versioned reconciliation policy and content-free result:

- policy version;
- whether skew calibration was applied;
- estimated offset in milliseconds;
- accepted anchor count;
- dropped microphone word count.

New finalizations always write these fields. The transcript trust parser accepts their absence on legacy persisted Parakeet rows, but strictly validates the exact object whenever it is present. No transcript text, audio path, identity, or anchor digest is added.

### Failure behavior

- Insufficient or conflicting anchors: run the existing zero-offset collapse only.
- Offset outside the bounded range: reject calibration and run existing behavior.
- Empty word timing data: skip adaptive alignment and preserve the current segment reconciler.
- Any final integrity failure: keep the prior transcript and move through the existing retryable failure contract; never commit the candidate.

## Existing Meeting Repair

The affected meeting remains unchanged until the implementation and focused suite pass. Repair then follows a controlled operator transaction:

1. Verify the meeting id, sealed capture generation, source paths, and current canonical digest.
2. Create a recoverable private backup of the database and the exact meeting row.
3. Run the corrected production Parakeet finalization against the sealed mic and System artifacts to produce a candidate without mutating the live row.
4. Require normal transcript integrity validation, the expected reconciliation policy, a strict reduction in strong duplicate pairs, and no loss of distinct source speech coverage.
5. Atomically replace the canonical transcript only if the meeting id, capture generation, and prior canonical digest still match.
6. Regenerate analysis and downstream artifacts from the exact corrected canonical transcript.
7. Reopen the meeting and verify the persisted/reloaded transcript and notes. Keep the backup until the user confirms the repair.

If any gate fails, leave the live row untouched and report the failed gate.

## Testing

Use test-driven development. The first regression test must fail against the current implementation using a synthetic approximately 1.2-second System delay.

Focused cases:

- stable 1.2-second skew collapses exact multi-word mic bleed;
- several aligned anchors calibrate while one conflicting anchor is ignored;
- fewer than three anchors do not calibrate;
- repeated ambiguous n-grams do not become anchors;
- offsets outside the bound do not calibrate;
- zero-skew behavior remains unchanged;
- short acknowledgements and distinct overlapping speech remain;
- missing word timings preserve the current fallback;
- persisted reconciliation metadata passes trust-shape validation;
- generation or prior-digest mismatch blocks repair commit;
- downstream analysis consumes the exact corrected transcript.

Verification includes the focused Vitest suite, TypeScript, changed-file Biome lint, `git diff --check`, changelog validation, a content-free dry run against the affected meeting, and persisted/reloaded application evidence after the guarded repair.

## Shipping Records

- Keep issue #657 current if scope or acceptance changes.
- Add a durable decision entry describing evidence-gated per-meeting clock-skew calibration.
- Add a uniquely named changelog fragment for #657.
- Link the issue, design, decision entry, validation evidence, and repair outcome from the pull request.
