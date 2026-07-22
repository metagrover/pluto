# Bound Transcript-Validation Retry Design

**Issue:** #539
**Parent:** #442

## Problem

Retry currently writes `transcript_status = validating` and replaces the prior
integrity record with only a run ID before starting three unbounded full-source
transcriptions. The initial write is not atomic, exceptions can strand the
meeting in `validating`, app restart has no expiry recovery, and a renderer-only
timeout would not stop sidecar CPU work.

## Product Contract

- A retry is a recoverable lease, never an indefinite state.
- The last complete content-free integrity evidence remains visible and durable
  while a retry runs.
- Progress names the current stage; Pluto does not invent a percentage.
- Timeout, cancellation, sidecar failure, or restart returns the meeting to an
  honest `needs_attention` state.
- A stale run cannot save a transcript or start downstream intelligence.

## Architecture

Store retry metadata inside `transcript_integrity_json.retry` alongside the
last complete integrity evidence:

```ts
type TranscriptValidationRetryLease = {
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: 'transcribing' | 'reviewing_evidence' | 'saving';
};
```

Claiming a retry is a database transaction. It succeeds only when no live lease
exists, preserves the existing integrity object, and writes the new lease plus
`transcript_status = validating`. Every stage update and terminal save compares
the expected run ID. Expired leases are recovered transactionally when meetings
are read at startup or reload.

The retry deadline covers source transcription, probing, reconciliation, and
the canonical transcript save. Title, analysis, and entity generation happen
only after the validated transcript is durably committed and are not part of
the validation lease. A validation timeout invokes a main-process cancellation
channel for that meeting before conditionally restoring `needs_attention`.

Cancellation aborts active fetches. For Pluto-owned WhisperX processes, the
main process also recycles the sidecar so synchronous Python inference cannot
continue after the client disconnects. External sidecars are not killed by the
app; their cancellation limitation is reported honestly while the meeting
still recovers from the expired lease.

## Deadline Policy

Use a deterministic, injectable policy with a generous floor and duration
scaling. The default deadline is the greater of 10 minutes or twice the meeting
duration. Tests inject a shorter deadline and clock; production does not use
fake progress or aggressive timeouts.

## Error Handling

- Timeout records `retry_timeout` and restores `needs_attention` only if the
  lease remains current.
- Other failures record `retry_failed` under the same compare-and-set rule.
- Superseded runs return without mutating state or generating intelligence.
- Late completion after cancellation cannot save because its lease no longer
  matches.
- Prior reasons and activity evidence remain intact through every path.

## UI

The integrity panel reads the durable lease. While active it shows the stage and
deadline context. After recovery it shows a retry action and the content-free
failure class. Reloading the renderer does not lose the state.

## Verification

Focused tests cover atomic double-claim rejection, evidence preservation,
stage persistence, timeout, thrown sidecar errors, expired-lease recovery,
supersession on success/failure/timeout, late completion, cancellation, and the
downstream-intelligence boundary. Existing retry-validation and meeting-view
tests remain green.

## Private Transcript Audit

Runtime integrity validation measures coverage and attribution evidence; it
cannot prove lexical accuracy. The latest meeting is audited separately and
locally by comparing independently generated mic, system, and mixed-source
transcripts against the preserved audio. No transcript text, identity, audio
path, or private evidence is added to GitHub or committed to the repository.

## Out of Scope

Durable per-source transcription caching, cross-restart source resumption, and
model-policy cache invalidation remain on #442.
