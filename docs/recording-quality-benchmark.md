# Recording Quality Benchmark

`pnpm run benchmark:recording-quality` runs Pluto's fast, content-safe `pr` recording benchmark tier. The command exercises current transcript-validation, retry-validation, and recording-finalization helpers against synthetic fixtures for the regression shapes tracked in `#25`, `#75`, `#428`, `#434`, and `#458`, then compares tracked metrics against the recorded `master` baseline.

Use `--tier manual` for explicitly opt-in long-running or hardware-sensitive cases and `--tier all` to run every declared tier. The command fails clearly when the selected tier has no cases, so an empty manual corpus cannot look like a successful quality run.

## What it writes

- A versioned JSON report under `tmp/recording-quality-benchmark-*.json`
- A concise terminal summary with pass counts, baseline drift status, and the artifact path

The report includes schema version, selected tier, environment metadata, source commit, per-case results, baseline comparisons, and any failing assertions.

## Corpus layout

- Manifest: `scripts/recording-quality/manifest.json`
- Fixtures: `scripts/recording-quality/fixtures/*.json`
- Baseline report: `scripts/recording-quality/baselines/current-master.json`

Each fixture must stay synthetic and content-safe. Do not commit private meeting text, audio paths, or raw recordings.
Retry-validation fixtures model persisted meeting state plus mocked transcription/probe responses, so they can cover fail-closed evidence handling without replaying private recordings.

Every manifest case declares one tier:

- `pr`: deterministic, content-safe, and fast enough for ordinary pull-request verification.
- `manual`: long-running or hardware-sensitive evidence that must be requested explicitly and should not slow the default gate.

Do not classify private or consented local-only corpora as `manual`; those remain outside source control and need their own local manifest contract.

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

## Private local speaker-attribution manifests

`#465` also needs consented local-only evaluation without leaking paths or transcript text. Use a gitignored JSON manifest such as `scripts/recording-quality/private-speaker-attribution-manifest.json` and validate it with:

`pnpm run benchmark:private-speaker-attribution:validate -- --manifest /absolute/path/to/private-speaker-attribution-manifest.json --out tmp/private-speaker-attribution-summary.json`

Manifest contract:

- `schemaVersion`: positive integer
- `cases[]`: non-empty array of private benchmark cases
- `cases[].id`: stable local case id used only for hashing/redaction
- `cases[].title`: non-empty local-only label for the operator
- `cases[].audio.mixedAudioPath`, `micAudioPath`, `systemAudioPath`: absolute local paths
- `cases[].transcript.groundTruthTranscriptPath`: absolute local path to the consented `Me`/`Them` ground-truth transcript artifact
- `cases[].transcript.speakers`: non-empty array containing only `Me` and `Them`

The validation summary intentionally emits only redacted case identifiers plus source-availability flags and speaker-set metadata. It never writes raw paths or transcript text to the JSON output.

## Adding a case

1. Add a new fixture JSON under `scripts/recording-quality/fixtures/`.
2. Add the case to `scripts/recording-quality/manifest.json` with its issue number, title, kind, relative fixture path, and explicit `pr` or `manual` tier.
3. Run `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`.
4. Run `pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark.json`.
5. Review the baseline summary:
   - `REGRESSION` means a stable tracked metric drifted outside tolerance and the command exits non-zero.
   - `IMPROVEMENT` means a stable tracked metric moved outside tolerance in the favorable direction.
   - `WITHIN_TOLERANCE` means the metric drift stayed within the allowed range.
   - `HARDWARE_DRIFT` means a hardware-dependent metric drifted outside tolerance but did not fail the run.
   - `MISSING_BASELINE` means the case or tracked metric is not present in the recorded baseline report.
6. If the new output is the intended `master` baseline, update `scripts/recording-quality/baselines/current-master.json`.

## Interpreting failures

- `status mismatch` means the current helper behavior no longer matches the committed regression expectation.
- Metric mismatches mean a tracked value such as `localTranscriptCoveredSeconds` or `durationSeconds` drifted.
- Retry-validation metric mismatches can also track labeled state such as `activityEvidenceSource`.
- Required-reason failures mean the benchmark no longer surfaces an expected integrity reason.
- Stable baseline regressions fail the command even when the fixture expectation itself still passes.
- Hardware-dependent drift and missing baseline entries stay visible in the summary so they can be reviewed before baseline updates.
