# Live Transcript Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure first accepted live-text latency and accepted live-update cadence with one content-free contract shared by AudioManager and deterministic recording-quality traces.

**Architecture:** A small `src/utils/liveTranscriptResponsiveness.ts` state machine owns all timing semantics and accepts injected monotonic timestamps. `AudioManager` calls it only at accepted session, publication, abort, and stop boundaries, then stores the frozen summary in the optional versioned transcript payload field. The recording-quality runner adds a synthetic trace case that executes the same state machine and gates declared deterministic expectations without claiming device performance.

**Tech Stack:** TypeScript, React refs, Vitest, Pluto recording-quality JSON fixtures and baseline

---

### Task 1: Pure responsiveness accumulator

**Files:**
- Create: `src/utils/liveTranscriptResponsiveness.ts`
- Create: `tests/unit/liveTranscriptResponsiveness.test.ts`

- [ ] **Step 1: Write the failing happy-path and no-text tests**

Define tests that import `createLiveTranscriptResponsivenessAccumulator` and
exercise the public API:

```ts
const accumulator = createLiveTranscriptResponsivenessAccumulator();
accumulator.start(100);
accumulator.publish(350, 2);
accumulator.publish(800, 1);
expect(accumulator.stop(1_000)).toEqual({
  schemaVersion: 1,
  status: 'available',
  firstTextLatencyMs: 250,
  acceptedPublicationCount: 2,
  cadenceSampleCount: 1,
  maximumUpdateGapMs: 450,
});
```

Add separate tests proving `publish(atMs, 0)` is ignored, one publication has
`maximumUpdateGapMs: null`, stop with no accepted publication returns
`no_accepted_live_text`, and `discard()` makes `snapshot()` return `null`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsiveness.test.ts
```

Expected: FAIL because `src/utils/liveTranscriptResponsiveness.ts` does not
exist.

- [ ] **Step 3: Implement the minimal accumulator**

Create the version-1 available, unavailable, and invalid summary types plus:

```ts
export type LiveTranscriptResponsivenessAccumulator = {
  start(atMs: number): void;
  publish(atMs: number, acceptedSegmentCount: number): void;
  stop(atMs: number): LiveTranscriptResponsivenessSummary;
  discard(): void;
  snapshot(): LiveTranscriptResponsivenessSummary | null;
};

export const createLiveTranscriptResponsivenessAccumulator =
  (): LiveTranscriptResponsivenessAccumulator => {
    // private state; no transcript or wall-clock values leave the module
  };
```

For available evidence, derive latency and gaps from stored monotonic numbers.
Do not expose raw event timestamps.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsiveness.test.ts
```

Expected: all happy-path/no-text tests pass.

- [ ] **Step 5: Write malformed-ordering tests**

Add one table-driven test for deterministic precedence:

1. non-finite or negative input -> `non_monotonic_time`;
2. publication before start -> `event_before_start`;
3. decreasing time after start -> `non_monotonic_time`;
4. publication after stop -> `publication_after_stop`;
5. second stop -> `duplicate_stop`.

Assert that the first invalid reason remains latched if later malformed events
occur.

- [ ] **Step 6: Run the malformed tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsiveness.test.ts
```

Expected: FAIL on the first unsupported malformed transition.

- [ ] **Step 7: Implement fail-closed transitions**

Add one `invalidate(reason)` helper that latches only the first reason. Validate
numbers before lifecycle state so non-finite/negative values always use
`non_monotonic_time`; otherwise use the lifecycle-specific reason order above.

- [ ] **Step 8: Run focused tests and commit**

Run the focused test, then:

```bash
git add src/utils/liveTranscriptResponsiveness.ts tests/unit/liveTranscriptResponsiveness.test.ts
git commit -m "feat: add live transcript responsiveness contract (#549)"
```

### Task 2: Deterministic recording-quality trace case

**Files:**
- Modify: `src/services/recordingQualityBenchmark.ts`
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Create: `scripts/recording-quality/fixtures/issue-549-live-transcript-responsiveness.json`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `scripts/recording-quality/baselines/current-master.json`

- [ ] **Step 1: Write failing parser and executor tests**

Add `live_transcript_responsiveness` to the expected case-kind union in the
test fixture. Define the fixture shape:

```ts
{
  startAtMs: number;
  events: Array<
    | { type: 'publish'; atMs: number; acceptedSegmentCount: number }
    | { type: 'stop'; atMs: number }
  >;
  expected: {
    status: 'validated' | 'needs_attention';
    primaryMetric?: { name: string; value: number | string | boolean };
    summary: LiveTranscriptResponsivenessSummary;
  };
}
```

Test a healthy trace, no-text trace, and malformed trace. Assert all summary
fields, not just the primary metric.

- [ ] **Step 2: Run benchmark unit tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
```

Expected: FAIL because the manifest parser/executor does not recognize the new
kind.

- [ ] **Step 3: Implement parsing and execution through the shared accumulator**

Import the accumulator. Parse only finite numeric timestamps/counts and the
finite event enum. Add
`runLiveTranscriptResponsivenessBenchmarkCase(meta, fixture)`, feed events in
order, compare the complete summary to `expected.summary`, and expose the named
primary metric from the summary. Available expected evidence maps to
`validated`; unavailable/invalid expected evidence maps to `needs_attention`.

- [ ] **Step 4: Run benchmark unit tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
```

Expected: all benchmark unit tests pass.

- [ ] **Step 5: Add the committed synthetic trace**

Add one PR-tier manifest entry linked to #549. The fixture uses offsets only:
start `100`, publications at `350`, `800`, and `1_100`, then stop at `1_300`.
Expected first-text latency is `250`, accepted publication count `3`, cadence
sample count `2`, and maximum update gap `450`.

Track `firstTextLatencyMs` as stable with tolerance `0`. Add the intended
schema-v3 baseline result and comparison entry after running the command; do
not copy hardware-dependent elapsed/CPU/RSS values into tracked metrics.

- [ ] **Step 6: Run the benchmark and commit**

Run:

```bash
pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark-549.json
```

Expected: 9 selected PR cases pass with zero stable regressions.

Then:

```bash
git add src/services/recordingQualityBenchmark.ts tests/unit/recordingQualityBenchmark.test.ts scripts/recording-quality/manifest.json scripts/recording-quality/fixtures/issue-549-live-transcript-responsiveness.json scripts/recording-quality/baselines/current-master.json
git commit -m "test: benchmark live transcript responsiveness (#549)"
```

### Task 3: Runtime capture and transcript metadata

**Files:**
- Modify: `src/utils/transcriptSchema.ts`
- Modify: `tests/unit/transcriptSchema.test.ts`
- Modify: `src/components/AudioManager.tsx`
- Create: `tests/unit/liveTranscriptResponsivenessWiring.test.ts`

- [ ] **Step 1: Write failing transcript-schema preservation tests**

Extend the payload test with:

```ts
liveTranscriptResponsiveness: {
  schemaVersion: 1,
  status: 'available',
  firstTextLatencyMs: 250,
  acceptedPublicationCount: 3,
  cadenceSampleCount: 2,
  maximumUpdateGapMs: 450,
}
```

Assert `buildTranscriptJsonPayload` returns it byte-for-byte. Add a separate
test proving the optional field remains absent for legacy callers.

- [ ] **Step 2: Run transcript-schema tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptSchema.test.ts
```

Expected: FAIL because the builder option/type does not accept the field.

- [ ] **Step 3: Add the optional schema field**

Import `LiveTranscriptResponsivenessSummary`, add the optional field to
`StoredTranscriptV2` and the builder options, and copy it into the returned
payload without transformation.

- [ ] **Step 4: Run transcript-schema tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptSchema.test.ts
```

Expected: all transcript-schema tests pass.

- [ ] **Step 5: Write failing AudioManager boundary tests**

Define and test a narrow
`createLiveTranscriptResponsivenessRuntime({ now })` adapter in
`src/utils/liveTranscriptResponsiveness.ts`. It owns one accumulator and exposes
`start()`, `discard()`, `publish(acceptedSegmentCount)`, `stop()`, and
`snapshot()`. Assert:

- accepted start calls accumulator `start`;
- aborted microphone acquisition calls `discard`;
- a chunk with newly accepted segments calls `publish` once before forwarding
  the unchanged aggregate live callback;
- an empty accepted set does not publish;
- stop freezes the summary before a supplied finalization callback;
- validated and `needs_attention` payload builders receive the same frozen
  summary.

Use spies only at the React/browser boundary; exercise the real accumulator.

- [ ] **Step 6: Run the wiring test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsivenessWiring.test.ts
```

Expected: FAIL because the runtime wiring helper does not exist.

- [ ] **Step 7: Implement the narrow AudioManager wiring**

Add one accumulator ref and one frozen-summary ref. Use `performance.now()` at
accepted start, accepted publication, and stop. Ensure every microphone-start
failure/reset path discards both refs. Compute `acceptedSegmentCount` from
`filteredMicSegments.length + filteredSystemSegments.length`; call `publish`
immediately before the existing `onLiveTranscript`.

Freeze at the stop snapshot before seal/finalization. Pass the frozen summary
to both normal and `needs_attention` `buildTranscriptJsonPayload` calls. Do not
add the field to seal-failure or launch-recovery records.

`AudioManager` stores the runtime adapter in a ref and delegates these five
boundaries to it. Do not refactor unrelated AudioManager logic.

- [ ] **Step 8: Run focused runtime tests and commit**

Run:

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsivenessWiring.test.ts tests/unit/liveTranscriptResponsiveness.test.ts tests/unit/transcriptSchema.test.ts
```

Then:

```bash
git add src/components/AudioManager.tsx src/utils/transcriptSchema.ts src/utils/liveTranscriptResponsiveness.ts tests/unit/liveTranscriptResponsivenessWiring.test.ts tests/unit/transcriptSchema.test.ts
git commit -m "feat: record live transcript responsiveness (#549)"
```

### Task 4: Documentation, changelog, and complete verification

**Files:**
- Modify: `docs/recording-quality-benchmark.md`

- [ ] **Step 1: Document the evidence boundary**

Explain that `live_transcript_responsiveness` fixtures execute declared
content-free event traces through the runtime accumulator. State explicitly
that stable trace expectations are not hardware/device measurements and that
runtime values remain observational until thresholds are separately approved.

- [ ] **Step 2: Commit benchmark documentation**

```bash
git add docs/recording-quality-benchmark.md
git commit -m "docs: explain live responsiveness evidence (#549)"
```

- [ ] **Step 3: Run all focused verification**

```bash
pnpm exec vitest run tests/unit/liveTranscriptResponsiveness.test.ts tests/unit/liveTranscriptResponsivenessWiring.test.ts tests/unit/transcriptSchema.test.ts tests/unit/recordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark-549.json
```

Expected: all focused tests pass and 9/9 PR benchmark cases pass with zero
stable regressions.

- [ ] **Step 4: Run repository verification**

```bash
pnpm run lint
pnpm run test -- --run
pnpm run audit:high
git diff --check origin/master...HEAD
```

Fix only failures caused by #549. Record unrelated current-master failures
without changing scope.

- [ ] **Step 5: Review privacy and scope**

```bash
git diff --name-only origin/master...HEAD
git diff origin/master...HEAD | rg -n "transcript text|audio path|participant|credential|telemetry" || true
git status --short --branch
```

Confirm every changed line maps to #549 and no private data or generated
benchmark report is staged.

- [ ] **Step 6: Push the verified branch and open the PR**

Push `codex/549-live-transcript-responsiveness`, create a PR against `master`
with the required issue, summary, changed behavior, verification, limitations,
and decision-record sections, and add `codex` plus `codex-automation`. Capture
the returned PR number.

- [ ] **Step 7: Add the changelog fragment with the actual PR**

Use the required fields:

```md
### Measure live transcript responsiveness

- **Issue:** [#549](https://github.com/metagrover/pluto/issues/549)
- **PR:** [#<actual-pr-number>](https://github.com/metagrover/pluto/pull/<actual-pr-number>)
- **Changed:** Pluto now records content-free first-live-text and accepted-update cadence evidence and gates the same semantics with deterministic benchmark traces.
- **Why:** Whole-case timers could not show whether live transcription reached the user promptly or updated regularly.
- **Replaced:** No previous live responsiveness evidence contract.
- **Notes:** Runtime values are observational; this change adds no threshold, UI behavior, private fixture, or external telemetry.
```

Create
`docs/changelog/entries/2026-07-29-549-live-transcript-responsiveness.md`
using the exact PR number, then run:

```bash
pnpm run changelog:check
git diff --check
```

- [ ] **Step 8: Commit and push the PR link**

```bash
git add docs/changelog/entries/2026-07-29-549-live-transcript-responsiveness.md
git commit -m "docs: link live responsiveness PR (#549)"
git push
```
