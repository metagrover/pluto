# Recording Quality Benchmark

`pnpm run benchmark:recording-quality` runs Pluto's fast, content-safe `pr` recording benchmark tier. The command exercises current capture-recovery, transcript-validation, retry-validation, recording-finalization, and candidate-distribution eligibility helpers against synthetic fixtures for the regression shapes tracked in `#25`, `#75`, `#428`, `#434`, `#458`, `#476`, and `#493`, then compares tracked metrics against the recorded `master` baseline.

Use `--tier manual` for explicitly opt-in long-running or hardware-sensitive cases and `--tier all` to run every declared tier. The command fails clearly when the selected tier has no cases, so an empty manual corpus cannot look like a successful quality run.

## What it writes

- A versioned JSON report under `tmp/recording-quality-benchmark-*.json`
- A concise terminal summary with pass counts, baseline drift status, and the artifact path

The schema-version-3 report includes selected tier, content-safe environment metadata, source commit, per-case results, candidate eligibility verdicts, baseline comparisons, any failing assertions, and one performance/resource measurement envelope per case.

## Performance and resource evidence

Every selected case reports four measurements:

- `elapsedTime`: monotonic wall-clock duration around case execution.
- `cpuTime`: combined user and system process CPU delta.
- `peakRss`: the highest process RSS sample observed before, during, or after the case at the report's declared sampling interval.
- `artifactBytes`: the sum of explicit deterministic files produced by a case, when that case owns an artifact list.

Elapsed time, CPU, and RSS are process-scoped and `hardware_dependent`. They appear in JSON plus one concise terminal `EVIDENCE` line per case, but they do not fail the default PR tier. The values are useful within a known environment; they are not claims that heterogeneous machines are directly comparable.

Artifact bytes are `stable` only when a case deliberately produces deterministic files from committed synthetic input. The capture-recovery case measures only the summed reconstructed mic/system artifact bytes before cleanup. It never writes paths, filenames, audio content, or checksums to the report. Other cases report `not_applicable` until they own an equally explicit artifact contract.

A measurement that cannot be collected is represented as `unavailable` with one finite reason: `not_applicable`, `unsupported_runtime`, or `collection_failed`. Missing evidence is never fabricated as zero. A collection failure does not replace a case's functional result.

Version-2 manifests remain readable. Version-2 baselines continue to provide functional comparisons; measurement tracking against an older baseline is visibly `MISSING_BASELINE` until a version-3 measurement is deliberately recorded. Unknown manifest schema versions fail clearly.

## Live transcript responsiveness evidence

The `live_transcript_responsiveness` case executes a declared content-free
event trace through the same monotonic accumulator used by `AudioManager`.
That contract reports first accepted live-text latency, accepted publication
count, cadence sample count, and the maximum gap between accepted
publications. A stopped trace with no accepted live text reports
`no_accepted_live_text`; malformed event ordering reports a finite invalid
reason instead of fabricating zero latency.

Committed trace values are deterministic expectations, not measurements of
device, model, or end-to-end application performance. They may be stable PR
gates because the fixture supplies the offsets. Values recorded during a real
meeting remain local observational metadata and hardware-dependent evidence;
this benchmark does not set a product latency threshold.

The summary contains numeric durations/counts plus finite status and reason
enums only. It contains no event timestamps, transcript text, participant or
meeting labels, file paths, audio, or credentials.

## Corpus layout

- Manifest: `scripts/recording-quality/manifest.json`
- Fixtures: `scripts/recording-quality/fixtures/*.json`
- Baseline report: `scripts/recording-quality/baselines/current-master.json`

Each fixture must stay synthetic and content-safe. Do not commit private meeting text, audio paths, or raw recordings.
Retry-validation fixtures model persisted meeting state plus mocked transcription/probe responses, so they can cover fail-closed evidence handling without replaying private recordings.
Capture-recovery fixtures materialize synthetic chunk bytes in a temporary directory, run the real interrupted-journal recovery boundary, and remove the artifacts after each case. Their gap reasons use `reason:source:sequence` labels so checksum or incomplete-tail regressions stay explicit without exposing content or paths.

Every manifest case declares one tier:

- `pr`: deterministic, content-safe, and fast enough for ordinary pull-request verification.
- `manual`: long-running or hardware-sensitive evidence that must be requested explicitly and should not slow the default gate.

Do not classify private or consented local-only corpora as `manual`; those remain outside source control and need their own local manifest contract.

Each manifest case can optionally declare `trackedMetrics`:

- `name`: the metric exposed by the benchmark result's `actual.primaryMetric`
- `tolerance`: the allowed numeric drift from the baseline
- `stability`: `stable` to fail the run on drift outside tolerance, or `hardware_dependent` to report drift separately without failing

Tracked names may reference the existing functional primary metric or `measurements.elapsedTime`, `measurements.cpuTime`, `measurements.peakRss`, and `measurements.artifactBytes`. Elapsed time, CPU, and RSS must remain `hardware_dependent`. Deterministic artifact bytes may be `stable`; the committed recovery case uses a zero tolerance so truncation or unexpected growth fails the gate.

## Local speaker-attribution benchmark

`pnpm run benchmark:speaker-attribution` runs the local speaker-attribution benchmark introduced for `#479`. It exercises candidate ASR/diarizer pipelines against committed synthetic fixtures through the JSONL adapter contract in `python/speaker_attribution_benchmark_adapter.py` and writes paired JSON/Markdown reports under `tmp/`.

- Manifest: `scripts/speaker-attribution/manifest.example.json`
- Synthetic fixtures: `scripts/speaker-attribution/fixtures/*.json`
- Focus: attribution WER/DER, false or missed `Me`, boundary error, overlap accuracy, short-local-turn recall, and runtime/memory

Use this command when changing local speaker-attribution scoring or candidate-runner behavior. Keep private-corpus validation and credential-free eligibility work on their dedicated issue paths (`#474` and `#477`) rather than extending this committed synthetic slice.

Candidate eligibility fixtures must also stay path-free and content-free. They should model only production-selection metadata such as distribution mode, checksum pinning, platform support, and credential requirements.

The `sherpa-onnx` diarizer candidate is the credential-free local path for
`#507`. Its manifest config must provide `segmentationModelPath`,
`segmentationSha256`, `embeddingModelPath`, `embeddingSha256`, and a
`distribution` object with reviewed license identifiers. The adapter refuses to
probe or run when either checksum or the redistribution review is missing. This
keeps the GitHub-hosted runtime and weights usable for local evaluation without
mistaking a downloadable artifact for an approved production dependency.

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
- Capture-recovery metric mismatches report drift in the recovered-to-acknowledged chunk ratio; missing source or gap assertions fail the case independently.
- Required-reason failures mean the benchmark no longer surfaces an expected integrity reason.
- Stable baseline regressions fail the command even when the fixture expectation itself still passes.
- Hardware-dependent drift and missing baseline entries stay visible in the summary so they can be reviewed before baseline updates.
