# Parakeet Cross-Channel Skew Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove strongly evidenced timestamp-skewed mic/System duplicates from Parakeet canonical transcripts and safely repair meeting `da1aa4ad-e54d-4ead-baf4-22062a905b9f` from sealed capture.

**Architecture:** Add a pure word-clock skew estimator, apply its bounded consensus offset inside the existing word-level bleed collapse, and persist content-free reconciliation metadata. Regenerate the affected meeting in an isolated database, then update the live row only through generation and exact-prior-byte compare-and-swap gates.

**Tech Stack:** TypeScript, Vitest, Electron, SQLite, FluidAudio/Parakeet Core ML, Biome, pnpm.

---

## File Map

- Create `src/services/finalTranscription/crossChannelSkew.ts` for pure n-gram anchor calibration.
- Create `tests/unit/crossChannelSkew.test.ts` for estimator safety and regression cases.
- Modify `src/services/finalTranscription/collapseCrossChannelWordBleed.ts` and its test for calibrated collapse.
- Modify `src/services/recordingTranscriptValidation.ts`, `src/services/finalTranscription/runFinalTranscription.ts`, and `src/utils/transcriptTrustState.ts` plus focused tests for provenance.
- Modify `docs/decisions.md` and add `docs/changelog/entries/2026-08-24-657-parakeet-skew-dedup.md`.

### Task 1: Estimate stable cross-channel word-clock skew

**Files:**
- Create: `src/services/finalTranscription/crossChannelSkew.ts`
- Create: `tests/unit/crossChannelSkew.test.ts`

- [ ] **Step 1: Write the failing estimator tests**

Use timed four-word phrases at 10, 30, 50, and 70 seconds, with every System phrase delayed by 1.2 seconds:

```ts
expect(estimateCrossChannelSkew({ micSegments, systemSegments })).toEqual({
  policyVersion: 'cross_channel_skew_v1',
  offsetSeconds: 1.2,
  anchorCount: 4,
  confidence: 1,
});
```

Add separate tests asserting `null` for fewer than three independent anchors, repeated ambiguous n-grams, offsets above 2.5 seconds, direct offsets at or below 0.75 seconds, and a dominant cluster below 75%. Add a case where four agreeing anchors beat one conflicting anchor.

- [ ] **Step 2: Run the estimator test and verify RED**

```bash
pnpm exec vitest run tests/unit/crossChannelSkew.test.ts --reporter=verbose
```

Expected: FAIL because `crossChannelSkew.ts` does not exist.

- [ ] **Step 3: Implement the minimal estimator contract**

```ts
export const CROSS_CHANNEL_SKEW_POLICY_VERSION =
  'cross_channel_skew_v1' as const;

export type CrossChannelSkewEstimate = {
  policyVersion: typeof CROSS_CHANNEL_SKEW_POLICY_VERSION;
  offsetSeconds: number;
  anchorCount: number;
  confidence: number;
};

export const estimateCrossChannelSkew = (input: {
  micSegments: AttributionSegment[];
  systemSegments: AttributionSegment[];
  anchorWords?: number;
  directToleranceSeconds?: number;
  maximumOffsetSeconds?: number;
  clusterWidthSeconds?: number;
  minimumIndependentAnchors?: number;
  minimumDominance?: number;
}): CrossChannelSkewEstimate | null => {
  // Defaults: 4, 0.75, 2.5, 0.24, 3, 0.75.
};
```

Flatten normalized timed words, keep only n-grams unique in each source, create bounded offset candidates, select the densest 0.24-second cluster, greedily count non-overlapping mic/System windows, and return the rounded median only when all gates pass. Round offset and confidence to six decimal places.

- [ ] **Step 4: Run the Step 2 command and verify GREEN**

Expected: all estimator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/finalTranscription/crossChannelSkew.ts tests/unit/crossChannelSkew.test.ts
git commit -m "fix(transcription): estimate cross-channel clock skew (#657)"
```

### Task 2: Apply calibrated skew during word-level bleed collapse

**Files:**
- Modify: `src/services/finalTranscription/collapseCrossChannelWordBleed.ts`
- Modify: `tests/unit/collapseCrossChannelWordBleed.test.ts`

- [ ] **Step 1: Write the failing 1.2-second collapse test**

Construct three independent calibration phrases and one target phrase, all with System delayed 1.2 seconds. Assert that the target is removed from mic, remains in System, and returns:

```ts
expect(result.reconciliation).toMatchObject({
  policyVersion: 'cross_channel_skew_v1',
  skewApplied: true,
  estimatedOffsetMs: 1200,
  anchorCount: 3,
});
```

Add a preservation case with only two anchors and legitimate adjacent repetition.

- [ ] **Step 2: Run the collapse test and verify RED**

```bash
pnpm exec vitest run tests/unit/collapseCrossChannelWordBleed.test.ts --reporter=verbose
```

Expected: the delayed duplicate remains and `reconciliation` is absent.

- [ ] **Step 3: Add direct and calibrated matching passes**

Keep offset `0` as the first candidate and append the estimator offset only on accepted calibration. Compare midpoints using:

```ts
const timingError = Math.abs(
  systemWord.at - micWord.at - alignmentOffsetSeconds,
);
```

Keep the existing exact consecutive-token and minimum-three-word requirements. Never remove System words. Return:

```ts
reconciliation: {
  policyVersion: 'cross_channel_skew_v1',
  skewApplied: estimate !== null,
  estimatedOffsetMs: estimate
    ? Math.round(estimate.offsetSeconds * 1_000)
    : 0,
  anchorCount: estimate?.anchorCount ?? 0,
  confidence: estimate?.confidence ?? 0,
  droppedMicWordCount: droppedMicWords.size,
  collapsedSequenceCount,
}
```

- [ ] **Step 4: Run focused reconciliation tests**

```bash
pnpm exec vitest run tests/unit/crossChannelSkew.test.ts tests/unit/collapseCrossChannelWordBleed.test.ts tests/unit/transcriptIntegrity.test.ts tests/unit/speakerAttribution.test.ts --reporter=dot
```

Expected: all selected files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/finalTranscription/collapseCrossChannelWordBleed.ts tests/unit/collapseCrossChannelWordBleed.test.ts
git commit -m "fix(transcription): collapse skewed Parakeet bleed (#657)"
```

### Task 3: Persist and validate reconciliation provenance

**Files:**
- Modify: `src/services/recordingTranscriptValidation.ts`
- Modify: `src/services/finalTranscription/runFinalTranscription.ts`
- Modify: `src/utils/transcriptTrustState.ts`
- Modify: `tests/unit/recordingTranscriptValidation.test.ts`
- Modify: `tests/unit/runFinalTranscription.test.ts`
- Modify: `tests/unit/transcriptTrustState.test.ts`

- [ ] **Step 1: Write failing boundary tests**

Assert `runRecordingTranscriptValidation` exposes the reconciliation result, `runFinalTranscription` passes it into `commitCanonical.metadata`, and trust parsing accepts this exact valid shape while rejecting `confidence: 2`. Retain a fixture proving a legacy Parakeet result without `reconciliation` still parses:

```ts
type CrossChannelReconciliationMetadata = {
  policyVersion: 'cross_channel_skew_v1';
  skewApplied: boolean;
  estimatedOffsetMs: number;
  anchorCount: number;
  confidence: number;
  droppedMicWordCount: number;
  collapsedSequenceCount: number;
};
```

- [ ] **Step 2: Run boundary tests and verify RED**

```bash
pnpm exec vitest run tests/unit/recordingTranscriptValidation.test.ts tests/unit/runFinalTranscription.test.ts tests/unit/transcriptTrustState.test.ts --reporter=verbose
```

Expected: FAIL because reconciliation metadata does not cross these boundaries.

- [ ] **Step 3: Thread the exact typed metadata through production**

Recovered-channel validation uses `collapsedChannels.reconciliation`. Checkpointed/full-mix paths emit the same policy with zero counters and `skewApplied: false`. Make `reconciliation` required in newly produced `FinalTranscriptionMetadata`, but optional in the persisted `TranscriptTrustEnvelopeV2` type for backward compatibility. Add `reconciliation` to the trust result's optional exact keys; when present, require all seven fields, an integer offset within plus or minus 2500 milliseconds, non-negative integer counts, and confidence from 0 through 1.

- [ ] **Step 4: Run boundary and adjacent suites**

```bash
pnpm exec vitest run tests/unit/crossChannelSkew.test.ts tests/unit/collapseCrossChannelWordBleed.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/runFinalTranscription.test.ts tests/unit/runPersistedMeetingFinalTranscription.test.ts tests/unit/transcriptIntegrity.test.ts tests/unit/transcriptTrustState.test.ts --reporter=dot
```

Expected: all selected files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recordingTranscriptValidation.ts src/services/finalTranscription/runFinalTranscription.ts src/utils/transcriptTrustState.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/runFinalTranscription.test.ts tests/unit/transcriptTrustState.test.ts
git commit -m "feat(transcription): persist skew reconciliation proof (#657)"
```

### Task 4: Record the durable decision and shipped outcome

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-24-657-parakeet-skew-dedup.md`

- [ ] **Step 1: Record the decision**

Document that calibration requires three independent unique four-word anchors, a 75% dominant cluster, and an absolute offset no greater than 2.5 seconds. Explain why fixed tolerance, generic save cleanup, and AEC remain rejected.

- [ ] **Step 2: Add the changelog fragment**

```md
---
date: 2026-08-24
issue: 657
category: Fixed
---

Parakeet final transcripts now remove strongly evidenced mic/System duplicates even when the source clocks are consistently offset, while preserving ambiguous overlapping speech.
```

- [ ] **Step 3: Validate and commit**

```bash
pnpm run changelog:check
git diff --check
git add docs/decisions.md docs/changelog/entries/2026-08-24-657-parakeet-skew-dedup.md
git commit -m "docs: record Parakeet skew reconciliation (#657)"
```

Expected: validation succeeds and the commit contains only the two shipping records.

### Task 5: Verify implementation and produce a candidate from the sealed meeting

**Files:**
- Read only: `/Users/metagrover/Library/Application Support/pluto/pluto.db`
- Read only: `/Users/metagrover/Library/Application Support/pluto/meetings/da1aa4ad-e54d-4ead-baf4-22062a905b9f/`

- [ ] **Step 1: Run repository verification**

```bash
pnpm exec biome lint src/services/finalTranscription/crossChannelSkew.ts src/services/finalTranscription/collapseCrossChannelWordBleed.ts src/services/recordingTranscriptValidation.ts src/services/finalTranscription/runFinalTranscription.ts src/utils/transcriptTrustState.ts tests/unit/crossChannelSkew.test.ts tests/unit/collapseCrossChannelWordBleed.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/runFinalTranscription.test.ts tests/unit/transcriptTrustState.test.ts
pnpm exec tsc --noEmit
pnpm exec vitest run tests/unit/crossChannelSkew.test.ts tests/unit/collapseCrossChannelWordBleed.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/runFinalTranscription.test.ts tests/unit/runPersistedMeetingFinalTranscription.test.ts tests/unit/transcriptIntegrity.test.ts tests/unit/speakerAttribution.test.ts tests/unit/transcriptTrustState.test.ts --reporter=dot
pnpm run changelog:check
git diff --check
```

Expected: every command succeeds.

- [ ] **Step 2: Build Electron and create recoverable database copies**

```bash
pnpm exec vite build
mkdir -p "/Users/metagrover/Library/Application Support/pluto/repair-backups"
sqlite3 "/Users/metagrover/Library/Application Support/pluto/pluto.db" ".backup '/Users/metagrover/Library/Application Support/pluto/repair-backups/2026-08-24-da1aa4ad-before.db'"
PARAKEET_REPAIR_DIR=$(mktemp -d /tmp/pluto-657-repair.XXXXXX)
sqlite3 "/Users/metagrover/Library/Application Support/pluto/pluto.db" ".backup '$PARAKEET_REPAIR_DIR/pluto.db'"
```

Verify both copies contain generation `f53f2c1e-93b2-4e8c-b375-ef1c7f2742c6` for the exact meeting id.

- [ ] **Step 3: Make only the clone eligible for finalization**

In one `BEGIN IMMEDIATE` transaction against the clone, require the exact meeting id, generation, and `validated` status, then set status/lifecycle to `provisional`, clear `transcript_validated_at`, remove `validationProof`, `finalTranscription`, `finalTranscriptionResult`, and `retry`, and clear downstream-derived columns. Require `changes() = 1`. The live database remains unchanged.

- [ ] **Step 4: Run isolated Electron finalization**

Link the existing Parakeet model directory into the clone user-data directory, then run:

```bash
pnpm exec electron . --user-data-dir="$PARAKEET_REPAIR_DIR"
```

Wait for the clone row to validate. Require the new policy, accepted bounded skew, successful mic/System sources, empty integrity reasons, duplicate count below 16, and preserved source coverage. Stop if any gate fails.

### Task 6: Atomically repair and verify the live meeting

- [ ] **Step 1: Re-read exact live guard values**

Confirm the live row still matches the backup byte-for-byte for transcript JSON and integrity JSON and still has the expected capture generation.

- [ ] **Step 2: Apply one compare-and-swap transaction**

Stop the normal Pluto app. Attach the backup as `prior` and clone as `candidate`. Update the live canonical/integrity/validation fields from `candidate`, clear downstream-derived fields, and constrain the `WHERE` clause by exact id, generation, prior transcript bytes, and prior integrity bytes. Require `changes() = 1`; otherwise roll back.

- [ ] **Step 3: Restart Pluto and verify persisted/reloaded state**

Wait for downstream processing, confirm its analysis input corresponds to the exact corrected canonical transcript, reopen the meeting, and verify the previously repeated passages render once and regenerated notes load after restart. Retain the backup through user confirmation.

- [ ] **Step 4: Final worktree check**

```bash
git status --short
git diff --check
```

Expected: no runtime or database artifacts exist in the worktree.
