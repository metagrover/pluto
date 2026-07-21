# Recording Benchmark Performance Envelope Design

**Issue:** [#532](https://github.com/metagrover/pluto/issues/532)

**Parent:** [#443](https://github.com/metagrover/pluto/issues/443)

**Status:** Approved direction; awaiting written-spec review

**Scope:** Content-safe performance and resource evidence for the committed recording-quality benchmark

## Outcome

Pluto's recording-quality benchmark reports enough performance and resource evidence to explain quality/latency tradeoffs without pretending heterogeneous developer and CI machines are directly comparable. Each committed synthetic case records an honest measurement envelope. Deterministic artifact sizes may participate in stable baseline gates; elapsed time, CPU, and sampled memory remain visible hardware-dependent evidence unless a later calibrated performance tier defines a trustworthy blocking contract.

This slice extends the existing benchmark report and comparison model. It does not benchmark live devices, run private corpora, change transcription or model policy, add UI, or make raw machine timing a default pull-request gate.

## Existing System

`src/services/recordingQualityBenchmark.ts` loads the version-2 manifest, executes synthetic cases, and writes a version-2 report. A case currently exposes one optional `actual.primaryMetric`. Manifest `trackedMetrics` entries compare that value with the committed baseline using either `stable` or `hardware_dependent` drift semantics.

The command already provides a safe corpus, prior-regression fixtures, retry and crash-recovery coverage, explicit `pr` and `manual` tiers, baseline tolerances, and a concise comparison summary. It records Node, platform, and architecture metadata, but it does not record case elapsed time, CPU usage, memory, or generated artifact size. That leaves #443 unable to show the cost side of quality changes.

## Design Principles

- **Evidence names its limits.** Every measurement records its method and availability. Unsupported values are not represented as zero.
- **Stable gates require deterministic inputs.** Only artifact sizes produced deterministically by a case may block the default tier.
- **Machine evidence is report-first.** Elapsed time, CPU, and sampled RSS are hardware-dependent and non-blocking in this slice.
- **Existing quality gates stay authoritative.** The measurement envelope supplements case expectations and current tracked metrics; it does not weaken them.
- **Collection stays content-free.** Reports include numeric measurements and finite reason codes, never audio, transcript text, local paths, titles beyond existing fixture metadata, or environment secrets.
- **The boundary remains testable.** Clocks, CPU readings, memory readings, and artifact observations are injected so unit tests remain deterministic.

## Report Contract

Bump the benchmark report schema to version 3. Every case result gains a `measurements` object with four named measurements:

```ts
type BenchmarkMeasurement =
  | {
      status: "available";
      value: number;
      unit: "milliseconds" | "microseconds" | "bytes";
      stability: "stable" | "hardware_dependent";
      method:
        | "monotonic_elapsed"
        | "process_cpu_delta"
        | "sampled_process_rss"
        | "case_artifact_sum";
    }
  | {
      status: "unavailable";
      reason: "not_applicable" | "unsupported_runtime" | "collection_failed";
    };

type BenchmarkMeasurements = {
  elapsedTime: BenchmarkMeasurement;
  cpuTime: BenchmarkMeasurement;
  peakRss: BenchmarkMeasurement;
  artifactBytes: BenchmarkMeasurement;
};
```

Available values must be finite, non-negative integers. Units and methods are fixed by measurement name. `elapsedTime`, `cpuTime`, and `peakRss` always have `hardware_dependent` stability. `artifactBytes` has `stable` stability because it is emitted only from deterministic case-produced files and is unavailable otherwise.

The report-level `environment` object additionally records a measurement-contract version and the memory sampling interval. It does not add hostname, username, absolute working directory, processor brand, or other identifying machine details.

## Collection Boundary

Wrap each case execution in a `BenchmarkMeasurementCollector` with injected adapters:

- a monotonic clock for elapsed milliseconds;
- a process CPU reader whose before/after delta produces combined user and system microseconds;
- a process RSS reader sampled immediately before execution, at a fixed interval while the case promise is pending, and immediately after settlement;
- an artifact observer supplied by the case executor.

The collector starts immediately before fixture execution and stops in `finally`, so failed cases still carry available measurements. A clock, CPU, or RSS adapter exception marks only that measurement `collection_failed`; it does not convert a correct case into a functional failure. The collector clears its sampling timer on success and failure.

CPU and RSS are explicitly process-scoped, not isolated per case. The concise report and documentation say so. Peak RSS is the maximum observed sample during the envelope, not an operating-system high-water mark. These limitations are why both remain non-blocking.

Elapsed time uses the monotonic clock delta rounded up to the next whole millisecond. CPU time is the non-negative combined process delta rounded to whole microseconds. RSS is the maximum non-negative whole-byte reading. Collection rejects non-finite or decreasing readings as `collection_failed` instead of clamping them into plausible evidence.

## Artifact Evidence

Artifact bytes come from files a case deliberately creates as part of the behavior under test. The shared runner does not scan temporary directories, fixture paths, or the repository.

In this slice, the `capture_recovery` executor reports the summed byte size of its reconstructed canonical mic and system WAV artifacts after recovery and before cleanup. The measurement contains only the total byte count. It does not expose filenames, paths, source identifiers, checksums, or audio contents.

Cases that do not produce a deterministic output artifact return `not_applicable`. Future executors may opt in only when they own an explicit artifact list and can prove deterministic bytes from committed synthetic input. The benchmark report itself is not counted as a case artifact, avoiding a circular size measurement.

## Metric and Baseline Integration

Extend case results from one optional primary metric to a named metric collection while preserving `actual.primaryMetric` for existing consumers. Existing functional metrics and the four measurement values are normalized into one internal lookup for comparison.

Manifest `trackedMetrics.name` may reference:

- an existing functional metric; or
- one of `measurements.elapsedTime`, `measurements.cpuTime`, `measurements.peakRss`, and `measurements.artifactBytes`.

Validation enforces the stability contract:

- `measurements.elapsedTime`, `measurements.cpuTime`, and `measurements.peakRss` may only be declared `hardware_dependent`;
- `measurements.artifactBytes` may be declared `stable` or `hardware_dependent`, though the committed recovery case uses `stable`;
- an unavailable tracked measurement produces `missing_baseline_metric` visibility and never a fabricated comparison;
- the existing stable-regression exit behavior remains unchanged for available stable metrics.

The committed capture-recovery case adds a zero-tolerance stable `measurements.artifactBytes` metric after its intended canonical byte count is recorded on `master`. This detects accidental recording-artifact growth or truncation. The three machine-dependent measurements appear in every result and the terminal evidence section but are not added as blocking tracked metrics.

## Compatibility and Versioning

The checked-in manifest and baseline advance from schema version 2 to schema version 3 with the implementation. The loader continues to accept version 2 manifests by normalizing them to the version-3 runtime contract with no measurement tracking declarations. Unknown versions fail with the existing clear schema error.

The baseline loader accepts version 2 reports for functional comparisons. Measurement comparisons against a version-2 baseline yield `missing_baseline_metric` until a version-3 baseline is deliberately recorded. It never treats absent version-2 measurements as zero. New reports are always version 3.

This compatibility keeps downstream callers and older local baselines usable while making new evidence explicit. `actual.primaryMetric` remains serialized in version 3; removing it is outside this slice.

## Concise Terminal Report

Keep the current pass/fail and baseline-drift summary. Add one compact evidence line per selected case:

```text
EVIDENCE issue-493-capture-recovery elapsed=12ms cpu=8400us peak_rss=128450560B artifacts=16428B
```

Unavailable values use their finite reason, for example `artifacts=unavailable:not_applicable`. Evidence lines never determine the exit code on their own. Existing `REGRESSION`, `IMPROVEMENT`, `WITHIN_TOLERANCE`, `HARDWARE_DRIFT`, and `MISSING_BASELINE` lines remain the comparison authority.

The JSON report is the durable evidence record. Terminal formatting is intentionally concise and does not add machine identity or local paths.

## Failure Semantics

- **Functional case failure:** retain the case failure and any measurements collected before settlement.
- **Clock, CPU, or RSS collection failure:** mark only that measurement `collection_failed`; do not fail the functional assertion.
- **Artifact stat failure:** mark artifact bytes `collection_failed` and keep the case's functional result. The executor must not leak the failing path into the report.
- **Measurement stability mismatch in the manifest:** reject the manifest before executing cases.
- **Unavailable tracked measurement:** report missing evidence; do not compare against zero or fail as a stable regression.
- **Version-2 baseline:** preserve functional comparisons and visibly report missing measurement baselines.
- **Non-finite, negative, or decreasing adapter value:** mark that measurement `collection_failed`.

## Testing Strategy

Focused unit tests use injected deterministic adapters to prove:

- elapsed, CPU, sampled peak RSS, and artifact-byte normalization;
- sampling cleanup on successful and failed case execution;
- explicit `not_applicable`, `unsupported_runtime`, and `collection_failed` states;
- invalid numeric readings never become zero-valued evidence;
- capture recovery reports only the summed canonical artifact bytes;
- machine-dependent metrics cannot be configured as stable;
- stable artifact-size drift gates while hardware-dependent drift remains report-only;
- version-2 manifest and baseline compatibility plus unknown-version rejection;
- concise evidence lines contain units and finite unavailable reasons without paths;
- existing functional expectations and primary-metric comparisons remain unchanged.

Fresh command verification for implementation includes:

- `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`;
- `pnpm run benchmark:recording-quality -- --tier pr --out tmp/recording-quality-benchmark-532-pr.json`;
- `pnpm run benchmark:recording-quality -- --tier manual --out tmp/recording-quality-benchmark-532-manual.json` when the committed manifest contains a manual case, otherwise the existing explicit empty-tier failure is expected and documented;
- `pnpm run benchmark:recording-quality -- --tier all --out tmp/recording-quality-benchmark-532-all.json`;
- `pnpm run changelog:check`;
- `pnpm run lint`;
- `pnpm run test -- --run`;
- `pnpm run audit:high`;
- `git diff --check`.

## Delivery Boundary

Implementation stays in the existing recording-quality benchmark service, CLI, manifest, baseline, focused tests, and benchmark documentation. A small measurement collector module may be extracted if that keeps adapter and normalization logic independent from fixture execution; no generic telemetry framework is introduced.

The implementation records and reports evidence. It does not claim runner-to-runner performance comparability. A later issue may define a calibrated environment fingerprint, warmup policy, repetition count, variance threshold, and opt-in blocking performance tier after real evidence demonstrates those gates are trustworthy.

## Out of Scope

- live microphone, system-audio device, or Electron-renderer timing;
- time to first live transcript text or live update cadence from real capture;
- private or consented-local corpora;
- changing transcript, validation, attribution, or model-selection policy;
- UI or user-facing performance claims;
- hostnames, usernames, absolute paths, processor brands, or environment secrets in reports;
- blocking default CI on elapsed time, CPU, or memory;
- a calibrated performance runner, repeated statistical sampling, or variance gate;
- a generic application telemetry or profiling system.
