# Recording Quality Benchmark

`pnpm run benchmark:recording-quality` runs Pluto's committed, content-safe recording benchmark corpus. The command exercises current transcript-validation and recording-finalization helpers against synthetic fixtures for the regression shapes tracked in `#25`, `#75`, `#428`, and `#434`.

## What it writes

- A versioned JSON report under `tmp/recording-quality-benchmark-*.json`
- A concise terminal summary with pass counts and the artifact path

The report includes schema version, environment metadata, source commit, per-case results, and any failing assertions.

## Corpus layout

- Manifest: `scripts/recording-quality/manifest.json`
- Fixtures: `scripts/recording-quality/fixtures/*.json`
- Baseline report: `scripts/recording-quality/baselines/current-master.json`

Each fixture must stay synthetic and content-safe. Do not commit private meeting text, audio paths, or raw recordings.

## Local speaker-attribution benchmark

`pnpm run benchmark:speaker-attribution` runs the local speaker-attribution benchmark introduced for `#479`. It exercises candidate ASR/diarizer pipelines against committed synthetic fixtures through the JSONL adapter contract in `python/speaker_attribution_benchmark_adapter.py` and writes paired JSON/Markdown reports under `tmp/`.

- Manifest: `scripts/speaker-attribution/manifest.example.json`
- Synthetic fixtures: `scripts/speaker-attribution/fixtures/*.json`
- Focus: attribution WER/DER, false or missed `Me`, boundary error, overlap accuracy, short-local-turn recall, and runtime/memory

Use this command when changing local speaker-attribution scoring or candidate-runner behavior. Keep private-corpus validation and credential-free eligibility work on their dedicated issue paths (`#474` and `#477`) rather than extending this committed synthetic slice.

## Adding a case

1. Add a new fixture JSON under `scripts/recording-quality/fixtures/`.
2. Add the case to `scripts/recording-quality/manifest.json` with its issue number, title, kind, and relative fixture path.
3. Run `pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts`.
4. Run `pnpm run benchmark:recording-quality -- --out tmp/recording-quality-benchmark.json`.
5. If the new output is the intended `master` baseline, update `scripts/recording-quality/baselines/current-master.json`.

## Interpreting failures

- `status mismatch` means the current helper behavior no longer matches the committed regression expectation.
- Metric mismatches mean a tracked value such as `localTranscriptCoveredSeconds` or `durationSeconds` drifted.
- Required-reason failures mean the benchmark no longer surfaces an expected integrity reason.
