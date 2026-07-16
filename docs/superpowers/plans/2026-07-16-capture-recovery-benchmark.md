# Capture Recovery Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a content-safe committed recording-quality case that proves interrupted mic/system capture journals recover acknowledged evidence while excluding and reporting a corrupt tail.

**Architecture:** Extend the existing benchmark manifest with a `capture_recovery` case and a JSON fixture describing synthetic byte payloads and one corrupted tail. The benchmark runner will materialize that fixture in a temporary directory through the real capture-journal APIs, invoke the real recovery boundary, translate the persisted integrity metadata into stable metrics, and always remove temporary artifacts.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest, Pluto capture-journal and recording-quality benchmark services.

---

### Task 1: Define the recovery fixture contract

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `src/services/recordingQualityBenchmark.ts`

- [ ] **Step 1: Write the failing manifest test**

Add a manifest case with `kind: 'capture_recovery'` and assert that `loadRecordingQualityBenchmarkManifest` accepts it rather than throwing `Unsupported benchmark case kind`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`

Expected: FAIL because `capture_recovery` is not an accepted case kind.

- [ ] **Step 3: Add the minimal type and manifest support**

Extend `RecordingQualityBenchmarkCaseKind` and its manifest validation branch with `capture_recovery`. Define a fixture with a meeting id, start time, synthetic mic/system chunks, a corrupt-tail selector, and expected status/reasons/metric.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`

Expected: PASS.

### Task 2: Execute recovery through the real boundary

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `src/services/recordingQualityBenchmark.ts`

- [ ] **Step 1: Write the failing recovery execution test**

Create a temporary directory, invoke `runCaptureRecoveryBenchmarkCase` with valid mic/system chunks plus a same-size corrupted mic tail, and assert `needs_attention`, `recoveredChunkRatio = 0.75`, independent mic/system paths, and a `checksum_mismatch` reason.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`

Expected: FAIL because `runCaptureRecoveryBenchmarkCase` does not exist.

- [ ] **Step 3: Implement the minimal recovery case runner**

Materialize the fixture using `createCaptureJournal` and `appendCaptureJournalChunk`, corrupt only the selected artifact after journaling, call `recoverInterruptedCaptureJournals`, parse the saved meeting integrity JSON, calculate recovered-to-acknowledged chunk ratio, compare expectations, and remove the temporary directory in `finally`.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`

Expected: PASS with the recovery test exercising the real checksum/gap behavior.

### Task 3: Commit the case and baseline

**Files:**
- Create: `scripts/recording-quality/fixtures/issue-493-capture-recovery.json`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `scripts/recording-quality/baselines/current-master.json`
- Modify: `scripts/run_recording_quality_benchmark.ts`
- Modify: `docs/recording-quality-benchmark.md`
- Create: `docs/changelog/entries/2026-07-16-493-capture-recovery-benchmark.md`

- [ ] **Step 1: Add a failing CLI expectation**

Update the existing CLI test to expect issue `493` and the `capture_recovery` kind in the emitted report.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`

Expected: FAIL because the CLI does not dispatch the new case and the manifest does not include it.

- [ ] **Step 3: Wire the fixture into the CLI and corpus**

Dispatch `capture_recovery` cases to the new runner, add the content-safe fixture and manifest entry, run the command once, then record its stable `recoveredChunkRatio` baseline. Document that the committed corpus now covers crash/restart recovery and how recovery failures appear.

- [ ] **Step 4: Verify the complete slice**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts tests/unit/captureJournalRecovery.test.ts`

Run: `pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark-493.json`

Run: `pnpm run changelog:check && pnpm run lint && pnpm run test -- --run && git diff --check`

Expected: all commands exit 0; the benchmark reports issue `493`, one explicit checksum gap, and no stable baseline regression.

- [ ] **Step 5: Commit**

Stage only the issue-scoped plan, benchmark code, fixture, baseline, tests, docs, and changelog entry. Commit with `Add capture recovery benchmark coverage (#493)`.
