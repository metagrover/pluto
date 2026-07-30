# Stop-to-Validated Recording Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the monotonic interval from an accepted recording stop through the first acknowledged durable validated-transcript save, preserve that content-free evidence safely, and exercise it in the deterministic recording-quality corpus.

**Architecture:** A pure accumulator owns the strict summary contract and event-ordering rules. `AudioManager` starts and completes it at existing finalization boundaries, while narrow main-process conditional updates persist the metric and later derived fields only when the expected transcript generation is still current. The recording-quality runner reuses the pure contract with declared synthetic traces.

**Tech Stack:** TypeScript, React/Electron IPC, SQLite, Vitest, Pluto recording-quality manifest/baseline tooling.

---

### Task 1: Pure latency contract

**Files:**
- Create: `src/services/stopToValidatedLatency.ts`
- Create: `tests/unit/stopToValidatedLatency.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add focused tests that import the missing module and assert:

```ts
expect(createStopToValidatedLatencyAccumulator().snapshot()).toBeNull();
expect(accumulator.acceptStop(100)).toEqual({ outcome: 'recorded', summary: null });
expect(accumulator.completeValidatedSave(145)).toEqual({
  outcome: 'recorded',
  summary: { schemaVersion: 1, status: 'available', durationMs: 45 },
});
```

Cover delayed completion, completion before start, non-finite/decreasing timestamps, explicit unavailable reasons, duplicate terminal calls, cloned snapshots, and strict parsing that rejects unknown keys, versions, reasons, contradictory duration fields, and non-integer durations.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/stopToValidatedLatency.test.ts
```

Expected: failure because `src/services/stopToValidatedLatency.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure state machine**

Define:

```ts
export type StopToValidatedLatencySummary =
  | { schemaVersion: 1; status: 'available'; durationMs: number }
  | {
      schemaVersion: 1;
      status: 'unavailable';
      reason:
        | 'not_started'
        | 'invalid_timestamp'
        | 'timestamp_regression'
        | 'not_validated'
        | 'recovery_required'
        | 'validated_save_failed';
    };
```

Export a strict parser, metadata read/write helpers, and `createStopToValidatedLatencyAccumulator()` with `acceptStop`, `markUnavailable`, `completeValidatedSave`, and `snapshot`. Keep operation outcomes separate from immutable summaries and never retain wall-clock timestamps in a summary.

- [ ] **Step 4: Verify GREEN**

Run the focused test until all contract cases pass, then run Biome on the two files.

- [ ] **Step 5: Commit**

```bash
git add src/services/stopToValidatedLatency.ts tests/unit/stopToValidatedLatency.test.ts
git commit -m "feat: add stop-to-validated latency contract"
```

### Task 2: Transcript metadata and retry preservation

**Files:**
- Modify: `src/utils/transcriptSchema.ts`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `tests/unit/transcriptSchema.test.ts`
- Modify: `tests/unit/retryMeetingTranscriptValidation.test.ts`

- [ ] **Step 1: Write failing metadata and retry tests**

Assert that valid latency summaries round-trip through the transcript metadata envelope, malformed summaries are omitted, unknown private keys are rejected, and retry reconstruction preserves an existing valid summary without recomputing it.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptSchema.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts
```

Expected: new assertions fail because the schema and retry path do not know the latency field.

- [ ] **Step 3: Implement minimal schema wiring**

Add the optional summary to the versioned transcript metadata type and strict parser/serializer. In retry reconstruction, copy only a successfully parsed stored summary; omit malformed evidence.

- [ ] **Step 4: Verify GREEN**

Re-run both focused files and confirm every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/utils/transcriptSchema.ts src/services/retryMeetingTranscriptValidation.ts tests/unit/transcriptSchema.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts
git commit -m "feat: preserve finalization latency evidence"
```

### Task 3: Atomic persistence operations

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/types/global.d.ts`
- Modify: `tests/unit/dbMeetingTranscriptRetry.test.ts`
- Modify or create: the focused preload/main IPC test files that already cover meeting persistence operations

- [ ] **Step 1: Write failing database tests**

Create a validated meeting generation and assert a new conditional metric update:

```ts
expect(result).toEqual({ outcome: 'updated' });
```

Then prove identical replay returns `already_current`; changed transcript JSON, integrity JSON, validation timestamp, validated status, and acquired retry lease each return `conflict`; a missing row returns `missing`; and no unrelated column changes.

Add equivalent tests for a conditional derived-owned update that requires the post-patch transcript identity, updates only the allowlisted derived fields, and returns `conflict` after retry acquisition.

- [ ] **Step 2: Verify RED**

Run the focused database and IPC tests. Expected: failures for missing database methods and IPC contracts.

- [ ] **Step 3: Implement one conditional SQL update per operation**

Add typed inputs/results and transaction-backed methods. The metric operation compares the exact expected transcript JSON, integrity JSON, validation timestamp, and `validated` status. The derived operation compares the post-patch identity and updates only existing downstream-owned columns, retaining the existing expected-title guard. Expose both through allowlisted IPC.

- [ ] **Step 4: Verify GREEN**

Re-run database and IPC suites; inspect the SQL column list to confirm transcript, retry, user, audio, folder, favorite, and finalization fields are absent from the derived `SET` clause.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/main.ts electron/preload.ts src/types/electron.d.ts src/types/global.d.ts tests
git commit -m "feat: guard finalization metric persistence"
```

### Task 4: Finalization orchestration

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/services/diarizationFirstFinalization.ts` only if its typed handoff must carry the acknowledged generation
- Modify: `tests/unit/AudioManager.test.tsx`
- Modify: `tests/unit/diarizationFirstFinalization.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Prove:

- the accumulator starts only after `beginRecordingFinalization` accepts the stop;
- completion occurs only after the validated-save promise resolves;
- `needs_attention`, recovery-required, and recoverable save failures persist their finite unavailable reasons;
- downstream begins while the metric patch is pending;
- derived persistence waits for patch reconciliation and expects the replacement transcript JSON;
- metric `conflict`, `missing`, or `failed` suppresses derived persistence;
- retry acquisition immediately before the derived update yields `conflict`;
- no metric result changes validation/recovery status or blocks downstream computation.

- [ ] **Step 2: Verify RED**

Run the focused AudioManager/finalization tests and confirm the new ordering assertions fail against the current unconditional later save.

- [ ] **Step 3: Implement minimal orchestration**

Keep one accumulator per accepted finalization. Freeze the summary at the existing durable validated-save acknowledgement, begin the metric conditional patch without awaiting it, run downstream concurrently, then await both. Invoke the derived-only conditional update only for `updated` or `already_current`; otherwise discard stale derived persistence. Map non-validated paths to finite unavailable summaries without logging caught payloads or private values.

- [ ] **Step 4: Verify GREEN**

Re-run focused finalization, AudioManager, transcript-schema, retry, and database suites.

- [ ] **Step 5: Commit**

```bash
git add src/components/AudioManager.tsx src/services/diarizationFirstFinalization.ts tests/unit
git commit -m "feat: measure durable validated finalization"
```

### Task 5: Deterministic benchmark coverage

**Files:**
- Modify: `src/services/recordingQualityBenchmark.ts`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `scripts/recording-quality/master-baseline.json`
- Modify: `scripts/run_recording_quality_benchmark.ts`
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `tests/unit/runRecordingQualityBenchmark.test.ts`

- [ ] **Step 1: Write failing benchmark tests**

Add `stop_to_validated_latency` fixtures for healthy, delayed, non-validated, decreasing, completion-before-start, and duplicate-completion traces. Assert exact summary outcomes and that output labels them synthetic while elapsed/CPU/RSS remain hardware-dependent.

- [ ] **Step 2: Verify RED**

Run the two benchmark test files. Expected: manifest/kind/executor/schema failures for the new unsupported case.

- [ ] **Step 3: Implement minimal benchmark kind**

Parse declared finite monotonic events, drive the production accumulator, compare the strict summary with the declared exact expectation, and include content-free output in the existing versioned report. Add committed cases and baseline entries.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts tests/unit/runRecordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --tier pr
pnpm run benchmark:recording-quality -- --tier all
```

Expected: all declared cases pass with no missing baseline or stable regression.

- [ ] **Step 5: Commit**

```bash
git add src/services/recordingQualityBenchmark.ts scripts/recording-quality scripts/run_recording_quality_benchmark.ts tests/unit
git commit -m "test: benchmark stop-to-validated latency"
```

### Task 6: Documentation, changelog, and final verification

**Files:**
- Modify: `docs/recording-quality-benchmark.md`
- Create: `docs/changelog/entries/2026-07-30-551-stop-to-validated-latency.md`

- [ ] **Step 1: Document the exact contract**

Explain that the runtime metric is observational and local, synthetic trace expectations may gate exactly, absolute timestamps are never stored, and the interval ends at durable validated persistence rather than downstream analysis.

- [ ] **Step 2: Add the changelog fragment**

Include `Issue`, `PR`, `Changed`, `Why`, `Replaced`, and `Notes`; use `PR: pending` until the PR number exists, then replace it before final verification.

- [ ] **Step 3: Run focused and repository verification**

Run:

```bash
pnpm exec vitest run tests/unit/stopToValidatedLatency.test.ts tests/unit/transcriptSchema.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/dbMeetingTranscriptRetry.test.ts tests/unit/diarizationFirstFinalization.test.ts tests/unit/AudioManager.test.tsx tests/unit/recordingQualityBenchmark.test.ts tests/unit/runRecordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --tier pr
pnpm run benchmark:recording-quality -- --tier all
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
pnpm run audit:high
git diff --check origin/master...HEAD
```

Also scan changed files for absolute timestamps, transcript text, identities, paths, audio payloads, credentials, and caught error payload logging.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/recording-quality-benchmark.md docs/changelog/entries/2026-07-30-551-stop-to-validated-latency.md
git commit -m "docs: record finalization latency evidence"
```

- [ ] **Step 5: Review and deliver**

Inspect `git diff --stat origin/master...HEAD`, request an independent production-readiness review, fix every Critical/Important finding with focused regression coverage, repeat full verification, push, open a PR against `master`, add `codex` and `codex-automation`, replace the changelog PR placeholder, and update #551 with final evidence.
