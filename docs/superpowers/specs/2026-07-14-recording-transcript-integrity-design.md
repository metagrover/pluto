# Recording Transcript Integrity Design

**Issue:** [#428](https://github.com/metagrover/pluto/issues/428)  
**Status:** Approved design  
**Priority:** Accuracy and completeness over processing performance

## Outcome

Pluto must never silently treat an incomplete meeting transcript as complete. Every completed recording receives a full-session validation pass against its preserved audio channels. Live transcription remains useful and responsive, but it is provisional until Pluto accounts for captured speech in the canonical transcript.

Recording is Pluto's primary data-ingestion path. Summaries, action items, follow-ups, and knowledge extraction therefore depend on a validated transcript rather than best-effort chunk output.

## Privacy Boundary

Meeting data is sensitive and local-only. The implementation must not place meeting titles, dates, participant names, transcript excerpts, business content, audio paths, or raw diagnostic payloads in source control, GitHub issues, pull requests, changelog entries, committed logs, or test fixtures.

Tests use generated waveforms and synthetic phrases. Persisted diagnostics contain measurements, state transitions, and reason codes only. They must not duplicate transcript content.

## Current Failure Mode

The legacy pipeline decides whether to run full-session recovery from aggregate chunk statistics. It treats a speaker as present when that speaker has at least one segment. A few trivial local acknowledgements can therefore suppress recovery even when live chunk transcription omitted substantial local speech. Abundant remote text makes the overall transcript appear healthy.

This is a structural trust error: provisional transcript output is being used to decide whether the source evidence needs validation.

## Design Principles

1. Raw mic and system recordings are immutable source evidence.
2. Live chunk transcripts are provisional.
3. Full-session validation is mandatory for every completed recording.
4. Captured mic-only speech must appear in the canonical transcript or produce an explicit integrity failure.
5. Remote pass-through on the mic channel must not create duplicate local speech.
6. Downstream intelligence runs only from a validated transcript.
7. Failure remains recoverable from local raw audio.

## Lifecycle

A recording moves through explicit transcript states:

`recording` -> `validating` -> `validated`

Failures move from `validating` to `needs_attention`. Retrying returns the meeting to `validating`. A provisional transcript may be displayed during `recording`, `validating`, or `needs_attention`, but only `validated` is authoritative.

Stopping a recording finalizes both channel files before validation begins. Notes, title, and audio playback remain available while validation runs.

## Capture and Live Integrity

Capture continues to write independent microphone and system-audio channels. Each live chunk records content-free health evidence:

- chunk start and end time;
- mic and system speech-activity duration;
- conversion outcome;
- transcription outcome;
- local and remote transcript coverage duration; and
- retry count and reason codes.

A live integrity monitor compares mic-only activity with provisional local-speaker coverage. Sustained unexplained mic activity triggers a retry of the affected mic chunk and a visible warning that live transcription is falling behind. The raw channel continues recording regardless of transcription health.

Capture failures use distinct warnings. A silent, muted, disconnected, or permission-revoked microphone is reported as an input-capture problem, not a transcription problem.

Recovered live chunks are inserted by timestamp. They improve the provisional transcript but do not remove the mandatory final validation pass.

## Mandatory Full-Session Reconstruction

After capture finalization, Pluto always runs:

1. Full-session transcription of the mic channel for local-speaker candidates.
2. Full-session transcription of the mixed channel for canonical wording and timeline.
3. System-channel activity analysis and available system transcription for remote-speaker evidence.

Chunk output may supply useful timing or label evidence, but it cannot veto speech recovered from a full-session source.

The mandatory path replaces the legacy heuristic that runs full-session recovery only when aggregate chunk output appears sparse. Existing fallback reason codes may remain as diagnostics, but they no longer control whether final validation runs.

## Reconciliation

Reconciliation is a dedicated, deterministic unit with explicit inputs and outputs. It receives canonical mixed segments, mic candidates, system candidates, channel-activity windows, and provisional chunk segments.

It applies these rules:

- Speech supported primarily by mic-only activity is attributed to `Me`.
- Speech supported by system activity is attributed to `Them`.
- Time-overlapping and lexically similar mic/system segments are collapsed as remote pass-through.
- Mic-only canonical speech is preserved even when no matching chunk segment exists.
- Recovered segments retain canonical timestamps and chronological ordering.
- Ambiguous overlap is retained as an integrity concern rather than silently discarded.

The output contains reconciled segments plus content-free reconciliation evidence: covered duration per channel, unexplained activity duration, duplicate candidates, collapsed pass-through duration, and ambiguity reason codes.

## Integrity Gate

The integrity gate decides whether the candidate transcript may become authoritative. It checks:

- successful full-session processing of required sources;
- channel file duration against recording duration;
- local transcript coverage against mic-only speech activity;
- remote transcript coverage against system speech activity;
- unexplained active-audio intervals;
- duplicate and pass-through pressure; and
- unresolved reconciliation ambiguity.

Thresholds may tolerate normal voice-activity and timestamp imprecision, but thresholds never decide whether validation runs. They only decide whether mandatory validation passed.

If the gate passes, Pluto atomically stores the canonical transcript and marks it `validated`. If it fails, Pluto stores the provisional candidate separately, marks the meeting `needs_attention`, preserves raw audio, and exposes specific reason codes.

## Failure Handling

Full-session processing retries transient failures with bounded backoff. Successful intermediate artifacts remain available locally so retrying one source does not require discarding the others.

Representative user-facing conditions include:

- local speech detected but missing from the transcript;
- system-audio transcription failed;
- pass-through audio could not be reconciled safely;
- channel duration does not match the meeting; and
- the speech model could not process the full recording.

Users can retry validation from the preserved local audio without rerecording. Pluto never silently falls back to labeling the provisional chunk transcript as complete.

## Downstream Data Safety

Analysis, summaries, action items, follow-up drafts, knowledge extraction, and related automations require `validated`. They do not run for provisional or `needs_attention` transcripts.

Validation completion emits one idempotent downstream-processing event. Retries and app restarts must not duplicate derived meeting records.

## Persistence and Diagnostics

Persist the following content-free metadata with the meeting:

- pipeline and reconciliation versions;
- transcript lifecycle state;
- channel and recording durations;
- speech-activity and transcript-coverage durations;
- unexplained activity duration;
- live retry counts;
- full-session attempt counts;
- validation timestamps; and
- structured reason codes.

The persisted canonical transcript remains meeting content in the local application database. Diagnostics do not contain transcript text or user-identifying source paths.

## Testing

### Unit tests

- Sparse trivial local chunks plus substantial synthetic mic-only activity fail provisional integrity and require recovery.
- Healthy synthetic two-speaker input validates.
- Synthetic remote pass-through on the mic channel is collapsed without creating duplicate `Me` segments.
- Missing, truncated, or duration-mismatched channels produce explicit reason codes.
- Live mic activity without transcript coverage triggers retry and warning state.
- Chunk output cannot delete full-session mic-only speech.

### Reconciliation tests

- Full-session local speech absent from chunks is restored.
- Recovered segments preserve timestamps and ordering.
- Remote overlap appears once in the canonical transcript.
- Ambiguous overlap fails validation instead of silently dropping speech.
- Retrying from preserved artifacts is deterministic.

### End-to-end regression fixture

Use generated audio and synthetic text to model a long meeting with abundant remote output, only a few trivial provisional local segments, and substantial mic-only speech. Mandatory reconstruction must restore the substantive local segments and pass the coverage gate. The fixture contains no real meeting content or metadata.

### Downstream safety tests

- Derived processing does not run before validation.
- It runs once after successful validation.
- Validation retries do not duplicate derived records.

### Manual verification

- Record alternating and overlapping synthetic speech.
- Force a live mic-chunk transcription failure and confirm the warning appears while capture continues.
- Stop recording and confirm full-session reconstruction repairs the provisional transcript.
- Force validation failure and confirm diagnostics, raw-audio preservation, and retry behavior.

## Scope

This outcome includes live integrity monitoring, mandatory full-session reconstruction, deterministic reconciliation, validation state, minimal warning and retry UI, diagnostic persistence, and downstream gating.

It excludes broader recording-screen visual redesign, cloud processing, sharing meeting content, and unrelated transcription-model tuning.

## Shipping Bar

Pluto must either account for captured speech in a validated transcript or explicitly report that it could not. Silent transcript loss is never a successful outcome.
