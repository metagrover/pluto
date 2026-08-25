# Parakeet Shadow Receipt-Aligned Windowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore guarded Parakeet shadow transcription for real Chromium recorder timing without splitting or losing durable capture receipts.

**Architecture:** Keep the assembler as a pure receipt-integrity boundary. Replace its exact-boundary rejection with target-duration, receipt-aligned sealing, then prove the contract at both assembler and coordinator levels using persisted timing shapes. Keep MLX preview, final Parakeet transcription, capture processing, and decoder configuration unchanged until separate same-audio evidence justifies another change.

**Tech Stack:** TypeScript, Electron main process, Vitest, Biome, Pluto capture journals, FluidAudio Parakeet runtime.

---

## File map

- `electron/transcription/shadowWindowAssembler.ts` owns receipt validation,
  source-local continuity, and target-duration receipt grouping.
- `tests/unit/shadowWindowAssembler.test.ts` owns the pure regression for real
  recorder timing and invariant coverage.
- `tests/unit/parakeetLiveMeetingCoordinator.test.ts` owns dual-source submission,
  tail flush, cleanup, and content-free report behavior.
- `docs/decisions.md` corrects the durable shadow-window contract from exact to
  receipt-aligned target duration.
- `docs/changelog/entries/2026-08-24-662-parakeet-shadow-timing.md` records the
  shipped repair and its user-visible boundary.
- Local private reports under Pluto user data provide runtime evidence and are
  never committed.

### Task 1: Make the assembler accept real receipt timing

**Files:**
- Modify: `tests/unit/shadowWindowAssembler.test.ts`
- Modify: `electron/transcription/shadowWindowAssembler.ts`

- [ ] **Step 1: Replace the synthetic crossing rejection test with the persisted timing regression**

Add a helper using the content-free timestamps from a persisted capture
manifest:

```ts
const driftingReceiptEnds = [
  6.191, 11.232, 16.279, 21.319, 26.359, 31.36,
];

const driftingReceipts = (): ShadowReceipt[] =>
  driftingReceiptEnds.map((endSec, index) =>
    receipt({
      sequence: index,
      chunkStartSec: index === 0 ? 0 : driftingReceiptEnds[index - 1]!,
      chunkEndSec: endSec,
      repairAudioRelativePath: `meeting-1/repair/system-${index}.wav`,
    }),
  );
```

Replace `never splits a receipt that crosses a logical window boundary` with:

```ts
it('seals at the first receipt boundary beyond the target duration', () => {
  const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
  const receipts = driftingReceipts();
  const emitted = receipts.flatMap((entry) => assembler.add(entry));

  expect(emitted).toEqual([
    expect.objectContaining({
      startSec: 0,
      endSec: 31.36,
      firstSequence: 0,
      lastSequence: 5,
      receipts,
    }),
  ]);
  expect(assembler.flush()).toEqual([]);
});
```

- [ ] **Step 2: Run the regression and verify the old contract fails**

Run:

```bash
pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts -t "seals at the first receipt boundary beyond the target duration"
```

Expected: FAIL with `shadow_crosses_window_boundary` before production code is
changed.

- [ ] **Step 3: Implement target-duration receipt-aligned sealing**

In `ShadowWindowAssembler.add`, remove the pre-validation exact-boundary block.
After receipt, identity, sequence, and time validation and after pushing the
receipt, calculate the buffered span and seal when it reaches the target:

```ts
const windowStart = this.receipts[0]!.chunkStartSec;
const windowDuration = receipt.chunkEndSec - windowStart;
return windowDuration >= this.options.windowSeconds
  ? [this.seal(receipt.chunkEndSec)]
  : [];
```

Update the class comment to describe target-duration, receipt-aligned windows.
Do not add a replacement overshoot error: a complete durable receipt is the
atomic unit, and all malformed duration and continuity conditions are already
validated.

- [ ] **Step 4: Prove consecutive windows and integrity failures**

Extend the test with a seventh contiguous receipt and assert that it remains in
the next tail:

```ts
assembler.add(
  receipt({
    sequence: 6,
    chunkStartSec: 31.36,
    chunkEndSec: 36.4,
    repairAudioRelativePath: 'meeting-1/repair/system-6.wav',
  }),
);
expect(assembler.flush()).toMatchObject([
  { startSec: 31.36, endSec: 36.4, firstSequence: 6, lastSequence: 6 },
]);
```

Run the complete assembler suite. Expected: all tests pass, including identity,
sequence, time-gap, invalid receipt, exact cadence, nonzero start, and
idempotent-tail cases.

```bash
pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts
```

- [ ] **Step 5: Commit the assembler repair**

```bash
git add electron/transcription/shadowWindowAssembler.ts tests/unit/shadowWindowAssembler.test.ts
git commit -m "fix(transcription): accept real shadow receipt timing (#662)"
```

### Task 2: Prove realistic dual-source coordinator operation

**Files:**
- Modify: `tests/unit/parakeetLiveMeetingCoordinator.test.ts`

- [ ] **Step 1: Add a realistic receipt appender to the coordinator tests**

Use the same content-free timing shape and the existing receipt helper:

```ts
const appendDriftingWindow = async (
  coordinator: ParakeetLiveMeetingCoordinator,
  source: 'mic' | 'system',
) => {
  const ends = [6.191, 11.232, 16.279, 21.319, 26.359, 31.36];
  for (const [sequence, endSec] of ends.entries()) {
    await coordinator.append(
      receipt({
        source,
        sequence,
        chunkStartSec: sequence === 0 ? 0 : ends[sequence - 1]!,
        chunkEndSec: endSec,
      }),
    );
  }
};
```

- [ ] **Step 2: Write coordinator coverage before relying on the assembler test**

Add one test that starts the coordinator, appends the drifting window for both
sources, and stops it. Assert:

```ts
expect(client.append).toHaveBeenCalledTimes(2);
expect(client.append).toHaveBeenCalledWith(
  expect.objectContaining({
    source: 'mic',
    chunkStartSeconds: 0,
    chunkEndSeconds: 31.36,
  }),
);
expect(client.append).toHaveBeenCalledWith(
  expect.objectContaining({
    source: 'system',
    chunkStartSeconds: 0,
    chunkEndSeconds: 31.36,
  }),
);
expect(dependencies.writeReport).toHaveBeenCalledWith(
  expect.objectContaining({
    windowsSubmitted: { mic: 1, system: 1 },
    windowsCompleted: { mic: 1, system: 1 },
    failureCodes: [],
  }),
);
```

This is an integration regression for the previously observed zero-submission
`window_invalid` outcome.

- [ ] **Step 3: Run coordinator and assembler suites together**

```bash
pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts
```

Expected: both files pass and the coordinator no longer fences on drifting
boundaries.

- [ ] **Step 4: Commit coordinator evidence**

```bash
git add tests/unit/parakeetLiveMeetingCoordinator.test.ts
git commit -m "test(transcription): cover drifting dual shadow receipts (#662)"
```

### Task 3: Record the corrected contract and run the release gate

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-24-662-parakeet-shadow-timing.md`

- [ ] **Step 1: Correct the durable decision**

In the 2026-08-22 decision, replace “non-overlapping 30-second sealed windows”
with “contiguous, non-overlapping receipt-aligned windows that seal when they
reach the 30-second target.” Add that recorder cadence may overshoot the target
by one receipt and that exact slicing is intentionally outside the metadata
assembler.

- [ ] **Step 2: Add the changelog fragment**

Create the fragment with this content:

```md
### Restore Parakeet shadow transcription for real recorder timing

- **Issue:** [#662](https://github.com/metagrover/pluto/issues/662)
- **Changed:** Background mic and System Parakeet shadow windows now seal on durable receipt boundaries after reaching their 30-second target.
- **Why:** Browser recorder intervals drift, so the former exact 30.000-second boundary rejected ordinary recordings before submitting any shadow audio.
- **Safety:** Receipt identity, sequence, and time continuity still fail closed; live MLX text and canonical Parakeet finalization are unchanged.
```

- [ ] **Step 3: Run fresh focused and repository checks**

```bash
pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts tests/unit/dualShadowTrial.test.ts tests/unit/dualShadowTrialReport.test.ts tests/unit/parakeetLiveReceiptBridge.test.ts
pnpm exec biome lint electron/transcription/shadowWindowAssembler.ts tests/unit/shadowWindowAssembler.test.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts
pnpm exec tsc --noEmit
pnpm run changelog:check
git diff --check
```

Expected: all focused tests, changed-file lint, TypeScript, changelog validation,
and whitespace checks pass. Any repository-wide pre-existing failure must be
reported with exact output and must not be represented as success.

- [ ] **Step 4: Replay persisted timing without private output**

Read recent capture manifests from Pluto user data, extract only source,
sequence, start, and end values, and feed each source into
`ShadowWindowAssembler`. The content-free result must show at least one emitted
window per eligible source and no boundary error for the three sessions that
previously failed. Do not print meeting IDs, paths, checksums, or transcript
text.

- [ ] **Step 5: Run the same-audio Parakeet evidence command**

Use the existing private evaluator against the current native runtime, model
root, database, and audio root. Run one recent eligible meeting with no review
HTML and retain only its aggregate content-free console result outside the
repository:

```bash
pnpm run benchmark:private-parakeet -- \
  --runtime /absolute/private/parakeet-runtime \
  --database /absolute/private/pluto.db \
  --model-root /absolute/private/models/transcription/parakeet \
  --audio-root /absolute/private/audio-root \
  --limit 1
```

Compare its final Parakeet integrity, timing, RTF, and lexical aggregates with
the existing MLX/provisional reference. Do not change language hints, capture
constraints, or production decoder settings from this proxy comparison alone;
those require a controlled ground-truth corpus or a direct configuration A/B.

- [ ] **Step 6: Commit documentation and evidence boundary**

```bash
git add docs/decisions.md docs/changelog/entries/2026-08-24-662-parakeet-shadow-timing.md
git commit -m "docs: record restored shadow timing contract (#662)"
```

- [ ] **Step 7: Update issue #662 with traceability**

Post the branch, commits, exact verification commands, content-free replay
counts, and whether the same-audio evidence justified any additional production
change. Do not post private paths, meeting IDs, audio, or transcript content.

## Self-review

- The plan covers every design constraint: atomic receipts, continuity,
  realistic drift, dual sources, single tail flush, provisional-only behavior,
  persisted timing replay, and evidence-gated follow-up.
- No production decoder or capture change is bundled with the lifecycle repair.
- Types and method names match the current assembler and coordinator contracts.
- The implementation steps contain no placeholder production code; absolute
  private paths in the benchmark example are intentionally operator-supplied
  secrets and are resolved locally during execution rather than committed.
