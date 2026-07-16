# Recording Quality Benchmark

`pnpm run benchmark:recording-quality` runs Pluto's committed, content-safe recording benchmark corpus. The command exercises current transcript-validation, retry-validation, recording-finalization, and candidate-distribution eligibility helpers against synthetic fixtures for the regression shapes tracked in `#25`, `#75`, `#428`, `#434`, `#458`, and `#476`, then compares tracked metrics against the recorded `master` baseline.

## What it writes

- A versioned JSON report under `tmp/recording-quality-benchmark-*.json`
- A concise terminal summary with pass counts, baseline drift status, and the artifact path

The report includes schema version, environment metadata, source commit, per-case results, candidate eligibility verdicts, baseline comparisons, and any failing assertions.

## Corpus layout

- Manifest: `scripts/recording-quality/manifest.json`
- Fixtures: `scripts/recording-quality/fixtures/*.json`
- Baseline report: `scripts/recording-quality/baselines/current-master.json`

Each fixture must stay synthetic and content-safe. Do not commit private meeting text, audio paths, or raw recordings.
Retry-validation fixtures model persisted meeting state plus mocked transcription/probe responses, so they can cover fail-closed evidence handling without replaying private recordings.

Each manifest case can optionally declare `trackedMetrics`:

- `name`: the metric exposed by the benchmark result's `actual.primaryMetric`
- `tolerance`: the allowed numeric drift from the baseline
- `stability`: `stable` to fail the run on drift outside tolerance, or `hardware_dependent` to report drift separately without failing

## Local speaker-attribution benchmark

`pnpm run benchmark:speaker-attribution` runs the local speaker-attribution benchmark introduced for `#479`. It exercises candidate ASR/diarizer pipelines against committed synthetic fixtures through the JSONL adapter contract in `python/speaker_attribution_benchmark_adapter.py` and writes paired JSON/Markdown reports under `tmp/`.

- Manifest: `scripts/speaker-attribution/manifest.example.json`
- Synthetic fixtures: `scripts/speaker-attribution/fixtures/*.json`
- Focus: attribution WER/DER, false or missed `Me`, boundary error, overlap accuracy, short-local-turn recall, and runtime/memory

Use this command when changing local speaker-attribution scoring or candidate-runner behavior. Keep private-corpus validation and credential-free eligibility work on their dedicated issue paths (`#474` and `#477`) rather than extending this committed synthetic slice.

Candidate eligibility fixtures must also stay path-free and content-free. They should model only production-selection metadata such as distribution mode, checksum pinning, platform support, and credential requirements.

## Adding a case

1. Add a new fixture JSON under `scripts/recording-quality/fixtures/`.
2. Add the case to `scripts/recording-quality/manifest.json` with its issue number, title, kind, and relative fixture path.
3. Run `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`.
4. Run `pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark.json`.
5. Review the baseline summary:
   - `REGRESSION` means a stable tracked metric drifted outside tolerance and the command exits non-zero.
   - `IMPROVEMENT` means a stable tracked metric moved outside tolerance in the favorable direction.
   - `WITHIN_TOLERANCE` means the metric drift stayed within the allowed range.
   - `HARDWARE_DRIFT` means a hardware-dependent metric drifted outside tolerance but did not fail the run.
   - `MISSING_BASELINE` means the case or tracked metric is not present in the recorded baseline report.
6. If the new output is the intended `master` baseline, update `scripts/recording-quality/baselines/current-master.json`.

## Candidate eligibility gate

Use `candidate_eligibility` cases when a model or runtime should be blocked before any private bake-off or production integration work. These cases should assert only metadata-derived decisions:

- whether Pluto can distribute or Pluto-manage the artifact without user credentials;
- whether terms acceptance is already resolved;
- whether the artifact is pinned to an immutable checksum;
- whether the current platform is supported.

## Interpreting failures

- `status mismatch` means the current helper behavior no longer matches the committed regression expectation.
- Metric mismatches mean a tracked value such as `localTranscriptCoveredSeconds` or `durationSeconds` drifted.
- Retry-validation metric mismatches can also track labeled state such as `activityEvidenceSource`.
- Eligibility mismatches mean a candidate would now be incorrectly allowed or blocked for production consideration.
- Required-reason failures mean the benchmark no longer surfaces an expected integrity reason.
- Stable baseline regressions fail the command even when the fixture expectation itself still passes.
- Hardware-dependent drift and missing baseline entries stay visible in the summary so they can be reviewed before baseline updates.
