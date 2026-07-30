# Stop-to-Validated Recording Latency

**Issue:** [#551](https://github.com/metagrover/pluto/issues/551)

**Parent:** [#443](https://github.com/metagrover/pluto/issues/443)

**Roadmap:** [#446](https://github.com/metagrover/pluto/issues/446), [#65](https://github.com/metagrover/pluto/issues/65)

**Status:** Proposed design independently reviewed and approved; committed artifact pending separate review

## Outcome

Pluto measures the elapsed time from an accepted recording stop to the first
acknowledged durable save of a validated transcript. The measurement is local,
content-free, conflict-safe, and observational. It exposes finalization latency
without weakening transcript validation, recovery, or downstream gates.

## Current Gap

The recording-quality benchmark measures whole-case elapsed time, CPU, sampled
RSS, and deterministic artifact bytes. Pluto also records first accepted live
text and accepted live-update cadence. It does not yet measure the distinct
user-facing wait between pressing stop and obtaining a durably saved validated
transcript.

`AudioManager` already has the required lifecycle boundaries:

- `beginRecordingFinalization` accepts one stop request and freezes meeting time;
- the capture journal seals before normal finalization;
- full-session transcript validation produces either `validated` or
  `needs_attention`;
- `persistAttributedTranscriptBeforeDownstream` durably saves the validated
  transcript before analysis and entity extraction begin.

The completion timestamp is only truthful after that first validated save
acknowledges. Therefore it cannot be embedded in that same save without
measuring an earlier proxy.

## Chosen Approach

Add one pure monotonic accumulator and one narrow compare-and-save persistence
boundary.

1. Start the accumulator when `beginRecordingFinalization` accepts the stop.
2. Preserve fail-closed terminal reasons through seal, validation, and save
   failures.
3. When the first validated transcript save acknowledges, freeze the elapsed
   duration.
4. Start a transcript-owned conditional patch concurrently with downstream
   analysis. It succeeds only while the complete previously saved transcript
   generation is still current.
5. Before the later derived-intelligence save, await the patch result and use
   one atomic transcript-generation guard to update downstream-owned fields
   only. Patch failure never cancels or weakens downstream work.

The update is idempotent: replaying the identical summary against the identical
transcript generation is a no-op success. A newer transcript, acquired retry
lease, changed validation status, or changed transcript identity causes a
conflict result and remains untouched.

Rejected alternatives:

- **Timestamp before the validated save:** avoids a follow-up write but excludes
  durable-save latency and overstates success before persistence acknowledges.
- **Instrument the complete database transaction from the renderer:** would
  require cross-process clock coordination or main-process ownership of
  renderer lifecycle state, broadening the change beyond this measurement
  slice.
- **Persist absolute stop/completion timestamps:** enables cross-process timing
  but creates unnecessary event-time retention and could fabricate semantics
  across restart. This slice uses monotonic in-session duration only.

## Summary Contract

The stored summary is one strict discriminated union:

```ts
type StopToValidatedLatencySummary =
  | {
      schemaVersion: 1;
      status: 'available';
      durationMs: number;
    }
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

Available durations are finite non-negative integers. Unavailable values have
no duration. Parsers reject unknown keys, versions, statuses, reasons,
non-integers, and contradictory fields.

The transcript JSON metadata stores only this summary. It contains no absolute
timestamps, transcript text, identities, participant labels, paths, audio,
credentials, private evidence, or telemetry identifiers.

## Accumulator State Machine

The pure accumulator receives injected monotonic milliseconds. Its operation
result is separate from the summary:

```ts
type StopToValidatedLatencyOperation =
  | { outcome: 'recorded'; summary: StopToValidatedLatencySummary }
  | { outcome: 'already_terminal'; summary: StopToValidatedLatencySummary }
  | { outcome: 'invalid'; summary: StopToValidatedLatencySummary };
```

- `acceptStop()` starts exactly once.
- `markUnavailable(reason)` freezes a terminal unavailable summary.
- `completeValidatedSave()` requires a prior stop and a nondecreasing timestamp,
  then freezes the available duration.
- Calls after any terminal state return `already_terminal` with the existing
  summary and cannot rewrite history.
- Completion before start or with invalid/decreasing time returns `invalid`
  with the corresponding unavailable summary.
- `snapshot()` returns a cloned summary or `null` before a terminal state.

Runtime orchestration maps lifecycle outcomes to the finite reasons. It never
logs timestamps, paths, text, or caught error payloads.

## Durable Persistence Boundary

The initial validated transcript save remains the crash-safety gate before
downstream work. After it acknowledges:

1. freeze the available latency summary;
2. rebuild only the transcript JSON metadata with the summary;
3. immediately start a dedicated transcript-owned conditional update with:
   - meeting ID;
   - the exact previously acknowledged transcript JSON as the expected value;
   - the exact previously acknowledged transcript integrity JSON;
   - the exact validation timestamp;
   - expected transcript status `validated`;
   - the replacement transcript JSON;
4. treat unchanged identical replacement as success;
5. atomically require every expected field to match so retry lease acquisition
   or any newer transcript generation returns `conflict`;
6. classify the patch separately as `updated`, `already_current`, `conflict`,
   `missing`, or `failed`;
7. never overwrite title, notes, analysis, attention, folder, favorite, audio,
   finalization, or newer retry state.

The database metric operation is one conditional `UPDATE`. The renderer starts
it without awaiting before `runDownstream` begins. When downstream work and the
metric patch have both completed, the renderer invokes a separate conditional
derived-intelligence update only if the metric patch returned `updated` or
`already_current`. That operation:

- atomically requires the post-patch replacement transcript JSON containing the
  accepted summary, plus the same transcript integrity JSON, validation
  timestamp, and `validated` status used by the metric patch;
- updates only derived-owned columns such as title (under its existing expected
  title guard), enhanced notes, analysis fields, and value signals;
- never writes transcript JSON, transcript integrity, transcript status,
  validation timestamp, retry lease, audio paths, folder, favorite,
  finalization, or user notes;
- returns `updated`, `conflict`, or `missing`.

There is no read-then-unconditional-save sequence. A retry lease acquired after
metric reconciliation but before the derived update changes the guarded
generation and atomically produces `conflict`.

If the metric patch returns `conflict`, `missing`, or `failed`, derived
persistence is suppressed without attempting a second write. The already
computed downstream result may be discarded; it cannot justify writing against
an unverified transcript generation.

This ordering lets downstream analysis run concurrently with the narrow local
patch while preventing a later save from erasing it or a newer retry lease. A
conflict, missing row, or patch failure does not roll back the durable validated
transcript and does not cancel already completed downstream computation; it
only suppresses stale derived persistence. Retry code preserves a valid stored
summary and does not recompute clean-stop latency from retry wall-clock time. A
malformed stored summary is omitted rather than normalized into healthy
evidence.

## Non-Validated Lifecycles

- `needs_attention` records `not_validated` in its first durable meeting payload.
- capture-journal recovery-required records `recovery_required`.
- a failed initial validated save records no available duration; if a
  recoverable meeting can be saved, it records `validated_save_failed`.
- an aborted start before an accepted stop discards accumulator state.
- restart recovery and later retry do not invent a clean-stop duration.

These unavailable summaries are diagnostic evidence, not alternative success
states.

## Benchmark Integration

Add a `stop_to_validated_latency` recording-quality case kind using declared
synthetic monotonic traces. Committed fixtures cover:

- healthy validated completion;
- deliberately delayed validated completion;
- non-validated completion;
- decreasing timestamps;
- completion before start;
- duplicate completion behavior.

The result reports the same strict summary contract used at runtime. Declared
synthetic duration/reason expectations may be stable zero-tolerance gates.
Whole-case wall-clock, CPU, and RSS remain hardware-dependent report evidence.
Documentation and terminal output label the case synthetic and do not claim
device performance.

## Failure Handling

- Invalid event ordering fails closed into a finite content-free reason.
- Validation and recovery outcomes cannot be promoted by the metric.
- The observational patch runs concurrently with downstream work; the later
  atomic derived-owned update waits for both.
- Conditional-update conflicts preserve newer state.
- Missing or malformed stored evidence is never interpreted as zero latency.
- No caught error payload or private value enters the summary or benchmark
  artifact.

## Testing

TDD must prove:

- accumulator start, completion, delayed completion, invalid ordering,
  timestamp regression, operation outcomes, and terminal idempotency;
- strict parser rejection of unknown or contradictory fields;
- runtime start at accepted stop, unavailable outcome mapping, and completion
  only after the validated save promise resolves;
- the first validated transcript is durable before the metric update;
- compare-and-save success, identical replay, conflict, missing-row, and failed
  behavior;
- retry lease acquisition between initial save and metric patch produces an
  atomic conflict and cannot be overwritten;
- downstream work starts before the metric patch resolves;
- successful metric reconciliation makes the post-patch transcript JSON the
  expected identity for derived persistence;
- metric `conflict`, `missing`, or `failed` suppresses derived persistence;
- later derived-owned persistence atomically suppresses stale writes when a
  retry lease is acquired immediately before its conditional update;
- derived persistence cannot overwrite any transcript or user-owned field;
- retry paths preserve valid evidence;
- malformed evidence is omitted rather than normalized;
- benchmark manifest, fixture, executor, schema, baseline, report, and privacy
  coverage;
- existing recording finalization, responsiveness, transcript schema, retry,
  and quality benchmark suites remain green.

Final verification runs focused suites, every benchmark tier affected by the
manifest, the full test suite, lint, changelog validation, Pluto's high-severity
audit, and diff/privacy checks.

## Scope

In scope: in-session stop-to-durable-validated duration, strict content-free
metadata, conflict-safe transcript-generation persistence, later-save
reconciliation, retry preservation, and deterministic synthetic benchmark
coverage.

Out of scope: product thresholds, UI changes, stop-to-analysis latency,
cross-restart wall-clock timing, private/device corpus automation, model policy,
attribution changes, external telemetry, retention changes, and transcription
behavior changes.
