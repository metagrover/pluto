# Live Transcript Responsiveness Evidence

Issue: [#549 — Measure live transcript responsiveness](https://github.com/metagrover/pluto/issues/549)  
Parent: [#443 — Establish a meeting recording quality benchmark](https://github.com/metagrover/pluto/issues/443)

## Outcome

Pluto records privacy-safe evidence for time to first accepted live transcript
text and accepted live-update cadence. Runtime recording and deterministic
benchmark fixtures use the same accumulator and summary schema, so benchmark
claims match the semantics exercised by the application.

This slice measures the responsiveness contract. It does not set a product
threshold, change transcription behavior, or claim that synthetic timings are
device performance.

## Current gap

The schema-v3 recording-quality benchmark wraps each whole case with elapsed
time, process CPU, sampled RSS, and deterministic artifact-byte measurements.
Those measurements cannot answer two separate questions in #443:

1. How long after an accepted recording start did the first non-empty live
   transcript publication arrive?
2. How regularly did later accepted publications arrive?

`AudioManager` already exposes the real publication boundary through
`onLiveTranscript`, after chunk transcription, retry, filtering, attribution,
and accumulation. Today it does not retain content-free timing evidence for
that boundary.

## Design constraints

- All time inputs are injected monotonic millisecond values.
- The summary contains durations, counts, and finite reason enums only.
- It never contains wall-clock timestamps, transcript text, participant or
  meeting labels, file paths, audio, model credentials, or external IDs.
- Runtime evidence stays local in the meeting's existing transcript metadata.
- Runtime values are observational and hardware-dependent until a separate
  issue approves thresholds.
- Deterministic trace fixtures gate only their declared trace expectations.

## Shared accumulator

Add a focused module under `src/utils/` with one stateful accumulator interface:

- `start(atMs)` begins one session.
- `publish(atMs, acceptedSegmentCount)` records a publication only when the
  count of newly accepted, non-empty segments is positive.
- `stop(atMs)` freezes the summary before finalization begins.
- `discard()` clears an aborted session and makes `snapshot()` return `null`.

The accumulator returns a versioned summary:

```ts
type LiveTranscriptResponsivenessSummary =
  | {
      schemaVersion: 1;
      status: 'available';
      firstTextLatencyMs: number;
      acceptedPublicationCount: number;
      cadenceSampleCount: number;
      maximumUpdateGapMs: number | null;
    }
  | {
      schemaVersion: 1;
      status: 'unavailable';
      reason: 'no_accepted_live_text';
      acceptedPublicationCount: 0;
      cadenceSampleCount: 0;
      maximumUpdateGapMs: null;
    }
  | {
      schemaVersion: 1;
      status: 'invalid';
      reason:
        | 'event_before_start'
        | 'non_monotonic_time'
        | 'duplicate_stop'
        | 'publication_after_stop';
      acceptedPublicationCount: number;
      cadenceSampleCount: number;
      maximumUpdateGapMs: number | null;
    };
```

`firstTextLatencyMs` is `firstAcceptedPublicationAt - startAt`.
`maximumUpdateGapMs` is the largest interval between consecutive accepted
publications and is `null` when fewer than two publications exist.
`cadenceSampleCount` is therefore `acceptedPublicationCount - 1`.

Malformed ordering fails closed. Once invalid, the accumulator remains invalid
and never returns apparently healthy evidence. Repeated aggregate callback
payloads do not inflate cadence because `AudioManager` passes only the number of
new segments accepted by the current chunk.

## Runtime integration

`AudioManager` owns one accumulator ref per recording session.

1. Start it with `performance.now()` at the existing accepted start boundary
   where `startTimeRef` is set, `onRecordingStarted` fires, and recording state
   becomes active. The existing wall-clock meeting timestamp remains unchanged.
2. Discard it if microphone acquisition aborts the session.
3. After chunk retry/filtering/attribution accepts new non-empty segments,
   publish once immediately before the existing `onLiveTranscript` callback.
   Do not change the callback payload or timing.
4. Stop and snapshot it at the beginning of the existing stop snapshot, before
   journal sealing or derived finalization.
5. Attach the frozen summary to the versioned transcript payload metadata for
   normal validated or `needs_attention` meeting saves.
6. Apply the same field to both validated and `needs_attention` versioned
   transcript payloads. Seal-failure and interrupted launch-recovery records do
   not build a normal versioned transcript payload and must keep the field
   absent rather than inventing evidence.

Extend `StoredTranscriptV2` with an optional
`liveTranscriptResponsiveness` field. Optionality preserves old meetings and
launch-recovered records that never observed the live publication boundary.
Retry validation copies this metadata through the existing versioned transcript
payload instead of recomputing it.

## Benchmark integration

Add `live_transcript_responsiveness` to the recording-quality case kinds. Its
fixture contains only a start offset, ordered content-free events, and expected
summary values. It contains no transcript strings.

Committed PR-tier fixtures cover:

- healthy first text plus multiple cadence samples;
- delayed first text;
- a stopped trace with no accepted live text;
- malformed ordering.

The runner feeds each trace through the same accumulator used by
`AudioManager`. The case result exposes one declared primary metric at a time
through the existing benchmark comparison contract. The initial committed case
tracks deterministic `firstTextLatencyMs`; assertions also verify publication
count, cadence sample count, maximum gap, status, and reason.

The report and documentation call these values “synthetic trace expectations.”
The generic elapsed/CPU/RSS envelope remains hardware-dependent and is not
relabelled as live transcript latency.

## Failure behavior

- No accepted publication before stop yields `no_accepted_live_text`, never
  zero latency.
- A zero accepted-segment count is ignored and does not create cadence.
- Non-finite, negative, or decreasing timestamps invalidate the trace.
- Publication before start, publication after stop, or a second stop
  invalidates the trace with a specific finite reason.
- Invalid runtime evidence remains local and explicit; it does not block saving
  the meeting or replace transcript integrity status.
- Benchmark fixtures expecting valid evidence fail when the summary is invalid
  or unavailable.

## Testing

TDD proceeds in three boundaries:

1. Pure accumulator tests prove first-text latency, cadence, ignored empty
   publications, no-text semantics, discard, and every malformed ordering.
2. Benchmark tests prove fixture parsing, execution through the shared
   accumulator, stable baseline comparison, report serialization, and
   content-safe fixtures.
3. Focused `AudioManager` tests prove accepted start, aborted-start discard,
   newly accepted non-empty publication, and stop-before-finalization wiring
   without changing live callback behavior.

Final verification includes the focused suites, the recording-quality PR tier,
changelog validation, lint, full Vitest, high-severity audit, diff check, and
commit/push hooks.

## Documentation and compatibility

- Document the difference between runtime observational evidence and
  deterministic trace expectations in `docs/recording-quality-benchmark.md`.
- Add an issue-scoped fragment under `docs/changelog/entries/`.
- Do not add a durable decision-log entry: this implements #443's already
  approved measurement contract without choosing thresholds or product policy.
- Existing schema-v2 transcript payloads and schema-v2 benchmark manifests stay
  readable. The new transcript field is optional and the existing benchmark
  manifest remains schema version 3.

## Out of scope

- Product latency or cadence thresholds.
- Stop-to-validated latency.
- UI status, warnings, or redesign.
- Device QA automation or claims about real hardware performance.
- Private audio or consented local corpora.
- Model selection, attribution quality, or transcription changes.
- External telemetry, analytics, or new retention policy.
