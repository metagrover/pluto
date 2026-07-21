# Recording Benchmark Performance Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest, content-safe performance/resource measurements and deterministic recovered-artifact byte gating to Pluto's recording-quality benchmark.

**Architecture:** Extend the existing benchmark service with an injected measurement collector that wraps every case execution and attaches schema-v3 measurement results. Capture recovery explicitly materializes deterministic synthetic recovered artifacts and reports only their summed bytes. Existing primary metrics remain compatible while comparison lookup expands to named measurement metrics.

**Tech Stack:** TypeScript, Node.js process/performance/filesystem APIs, Vitest, JSON benchmark manifests and baselines.

---

### Task 1: Define and collect measurement evidence

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `src/services/recordingQualityBenchmark.ts`

- [ ] **Step 1: Write failing collector tests**

Add tests importing `measureRecordingQualityBenchmarkCase` that inject monotonic clock values, CPU deltas, RSS samples, and a no-op interval adapter. Assert available integer measurements, `hardware_dependent` stability, fixed methods/units, timer cleanup, preserved functional failures, and explicit `collection_failed` for invalid/decreasing readings. Add a test proving absent artifact evidence becomes `unavailable:not_applicable`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "measurement envelope"`

Expected: FAIL because `measureRecordingQualityBenchmarkCase` and the measurement contract do not exist.

- [ ] **Step 3: Implement the minimal collector**

In `src/services/recordingQualityBenchmark.ts`, add the exact available/unavailable union and the four-name measurement object from the approved spec. Add injectable adapters for monotonic time, process CPU, RSS, interval start, and interval clear. Implement `measureRecordingQualityBenchmarkCase` with `try/finally`, finite non-negative integer normalization, fixed units/methods/stability, process CPU user+system delta, sampled maximum RSS, and per-measurement `collection_failed` isolation. Preserve a case runner's existing artifact measurement; otherwise emit `not_applicable`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "measurement envelope"`

Expected: PASS.

- [ ] **Step 5: Commit collector slice**

Run:

```bash
git add src/services/recordingQualityBenchmark.ts tests/unit/recordingQualityBenchmark.test.ts
git commit -m "feat: collect recording benchmark measurements (#532)"
```

### Task 2: Produce deterministic artifact-byte evidence

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `src/services/recordingQualityBenchmark.ts`

- [ ] **Step 1: Write the failing capture-recovery artifact test**

Extend the capture-recovery test to assert an available `measurements.artifactBytes` using `case_artifact_sum`, `bytes`, and `stable`. Assert the value equals the byte lengths of the intact reconstructed mic/system synthetic chunks and that no path is serialized.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "recovers both sources"`

Expected: FAIL because capture recovery does not materialize or report artifact bytes.

- [ ] **Step 3: Implement deterministic recovered artifacts**

Change the benchmark-only `stitchWavSegments` adapter to read valid synthetic segment files, concatenate their bytes into the requested recovered output under the temporary case root, and return that path. Before cleanup, stat only the explicit recovered mic/system paths from integrity metadata, sum their byte sizes, and attach the stable artifact measurement. If stat fails, attach `collection_failed` without exposing a path.

- [ ] **Step 4: Run the capture and full focused tests**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "recovers both sources"
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit artifact slice**

Run:

```bash
git add src/services/recordingQualityBenchmark.ts tests/unit/recordingQualityBenchmark.test.ts
git commit -m "feat: measure recovered recording artifacts (#532)"
```

### Task 3: Integrate named measurements with schema and baselines

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `src/services/recordingQualityBenchmark.ts`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `scripts/recording-quality/baselines/current-master.json`

- [ ] **Step 1: Write failing schema/comparison tests**

Add tests proving version-2 and version-3 manifests load, unknown versions reject, machine measurement names reject `stable`, version-2 baselines yield missing measurement visibility, and `measurements.artifactBytes` compares as a stable named metric. Preserve existing primary-metric comparison behavior.

- [ ] **Step 2: Run schema/comparison tests and verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "measurement metric|manifest schema"`

Expected: FAIL because comparison lookup reads only `actual.primaryMetric` and schema/stability rules do not exist.

- [ ] **Step 3: Implement compatibility and named lookup**

Accept only manifest schema 2 or 3, normalize version 2 without measurement declarations, and reject unknown versions clearly. Validate measurement stability names from the spec. Add one helper that resolves either the existing primary metric or an available measurement into `RecordingQualityBenchmarkMetric`; use it for current and baseline comparison lookup. Keep unavailable values missing, never zero.

- [ ] **Step 4: Advance committed contracts**

Set the manifest and baseline report to schema version 3. Add zero-tolerance stable tracking for `measurements.artifactBytes` to the capture-recovery case. Record the intended deterministic capture artifact byte result in the baseline while retaining every existing functional metric and expectation.

- [ ] **Step 5: Run focused tests and benchmark**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --tier pr --out tmp/recording-quality-benchmark-532-pr.json
pnpm run benchmark:recording-quality -- --tier all --out tmp/recording-quality-benchmark-532-all.json
```

Expected: PASS with no stable regressions.

- [ ] **Step 6: Commit schema/baseline slice**

Run:

```bash
git add src/services/recordingQualityBenchmark.ts tests/unit/recordingQualityBenchmark.test.ts scripts/recording-quality/manifest.json scripts/recording-quality/baselines/current-master.json
git commit -m "feat: compare benchmark measurement evidence (#532)"
```

### Task 4: Wire CLI evidence reporting and documentation

**Files:**
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `scripts/run_recording_quality_benchmark.ts`
- Modify: `docs/recording-quality-benchmark.md`
- Modify: `docs/changelog/entries/2026-07-21-532-recording-benchmark-performance-envelope-design.md`

- [ ] **Step 1: Write failing CLI evidence assertions**

Update the CLI integration test to require schema version 3, measurement metadata, four measurements on every result, an available stable artifact byte value on capture recovery, and concise `EVIDENCE` lines with units or finite unavailable reasons. Assert serialized output contains no temporary recovery path.

- [ ] **Step 2: Run the CLI test and verify RED**

Run: `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts -t "committed benchmark corpus"`

Expected: FAIL because the CLI does not wrap cases or print evidence.

- [ ] **Step 3: Integrate collection and formatting**

Wrap each selected case execution with `measureRecordingQualityBenchmarkCase` using Node monotonic time, `process.cpuUsage`, `process.memoryUsage().rss`, and a fixed sampling interval. Add measurement-contract metadata to the report environment. Print one concise `EVIDENCE` line per case with `ms`, `us`, `B`, or `unavailable:<reason>`. Keep exit behavior tied to functional failures and stable comparisons only.

- [ ] **Step 4: Update durable documentation**

Document measurement meanings, process-scoped limitations, explicit unavailable states, stable artifact gating, schema-v2 compatibility, and the report-first policy in `docs/recording-quality-benchmark.md`. Update the #532 changelog entry from design-only language to delivered behavior and add the implementation PR number after creation.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --tier pr --out tmp/recording-quality-benchmark-532-pr.json
pnpm run changelog:check
git diff --check
```

Expected: PASS.

Commit:

```bash
git add tests/unit/recordingQualityBenchmark.test.ts scripts/run_recording_quality_benchmark.ts docs/recording-quality-benchmark.md docs/changelog/entries/2026-07-21-532-recording-benchmark-performance-envelope-design.md
git commit -m "docs: explain benchmark performance evidence (#532)"
```

### Task 5: Final verification and delivery

**Files:**
- Verify all issue-scoped files.

- [ ] **Step 1: Run the full verification matrix**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
pnpm run benchmark:recording-quality -- --tier pr --out tmp/recording-quality-benchmark-532-pr.json
pnpm run benchmark:recording-quality -- --tier all --out tmp/recording-quality-benchmark-532-all.json
pnpm run benchmark:recording-quality -- --tier manual --out tmp/recording-quality-benchmark-532-manual.json
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
pnpm run audit:high
git diff --check origin/master...HEAD
```

Expected: focused/default/all, changelog, lint, full tests, audit, and diff checks pass. The manual command exits with the existing explicit `No manual benchmark cases` error because no committed manual case exists.

- [ ] **Step 2: Review scope and privacy**

Run `git diff --name-only origin/master...HEAD` and inspect the final JSON outputs. Confirm only issue files changed and no audio, transcript text beyond existing synthetic fixtures, private paths, credentials, or generated reports are staged.

- [ ] **Step 3: Push and open the implementation PR**

Push `codex/532-recording-benchmark-performance-envelope-implementation`, open a non-draft PR against `master`, label it `codex` and `codex-automation`, update the changelog PR link, rerun changelog/diff verification, and post the final #532 issue update with exact results and follow-ups.
