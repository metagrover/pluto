# Provisional live speaker identity acceptance

## Status

Engineering implementation is present behind the default-off
`voice_profile_live_suggestions_v1` setting. The consented private quality and
resource benchmark is **NOT RUN**. This document therefore does not clear the
feature for default enablement.

## Implemented safety contract

- Analysis runs only after explicit opt-in and receives a bounded 45-second
  microphone/System PCM snapshot inside the native runtime.
- A name is presented only after the same precision-gated profile match is
  observed in two consecutive evidence revisions.
- Hints decorate only transcript rows fully covered by a matched interval.
- Embeddings, profile identifiers, scores, and candidate digests stay in the
  native/Electron-main boundary. Renderer IPC accepts only a strict, sanitized
  label/range envelope and rejects unknown fields.
- Confirm and reject are reversible. A confirmation is persisted as pending,
  then becomes an explicit user binding only when the finalized timed
  transcript overlaps one anonymous remote speaker unambiguously. Ambiguous
  results remain `needs_review`.
- Live analysis failures never fail capture or live transcription. Disabling
  the setting stops analysis and clears displayed hints.

## Automated evidence

- TypeScript type checking passes.
- Focused unit coverage exercises native-response validation, two-revision
  continuity, revocation/rejection/restore, IPC sanitization, transcript-row
  stability, schema migration, and final binding reconciliation.
- The production native runtime builds successfully with the project build
  script. Focused Swift tests are present for protocol routing and the bounded,
  synchronized PCM window, but the local Command Line Tools installation cannot
  resolve `XCTest`; this is an environment limitation, not a passing test.

## Release gates still required

Before default enablement, run a consented held-out corpus containing enrolled
and unenrolled speakers, overlap, playback/echo, noisy and silent intervals,
profile disable/delete/merge, and repeated rolling windows. Record only
aggregate metrics. Required outcomes remain:

- zero observed false named suggestions, with denominator and confidence bound;
- non-zero useful coverage and time-to-first-suggestion;
- acceptable concurrent EOU latency, CPU and memory cost;
- real-recording stop, finalization, reload, notes, disable and old-runtime
  compatibility checks with the feature both on and off.

