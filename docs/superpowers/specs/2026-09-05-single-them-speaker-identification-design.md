# Single `Them` Speaker Identification

**Issue:** [#761](https://github.com/metagrover/pluto/issues/761)
**Status:** Approved for implementation planning

## Problem

Pluto's guided speaker review currently includes only canonical labels matching
`Remote Speaker N`. When source-aware transcription confidently separates the
local user from one aggregate remote participant, the honest canonical label is
`Them`. That common one-on-one case has no header review action and its
transcript speaker label is not clickable, even though the existing identity
backend can store a meeting-scoped binding for `Them`.

## Outcome

Users can identify a single `Them` participant from either the meeting header
or the `Them` label inside the transcript. Pluto displays the confirmed person's
name throughout that meeting while retaining `Them` as the canonical transcript
evidence.

## Behavior

Speaker review derives one ordered list of reviewable anonymous speakers:

1. If the meeting contains one or more `Remote Speaker N` labels, use those
   numbered speakers exactly as today.
2. Otherwise, if the meeting contains `Them`, expose one reviewable speaker
   whose canonical binding key is `Them`.
3. Never expose both numbered remote speakers and the aggregate `Them` bucket in
   the same review session.

An unbound fallback `Them` contributes one to the meeting header's unidentified
speaker count. Clicking the header opens the guided review at `Them`. Clicking a
`Them` label in a transcript turn opens the same modal directly at `Them`.

The existing person search, create-person action, binding persistence,
auto-advance behavior, undo behavior, and display-name projection are reused.
Once bound, every displayed `Them` turn shows the selected person's name; the
stored transcript segments remain `Them`.

## Audio sample behavior

The review modal may request a sample for `Them` using the same bounded,
non-overlapping interval selection used for numbered remote speakers. The sample
continues to come from the meeting's System recording. If no safe sample is
available, identification remains possible from the excerpt and person picker.

## Trust and error handling

- A `Them` binding is an explicit user confirmation, not diarization proof.
- The binding applies only to this meeting and does not rewrite transcript JSON.
- The UI must not imply that aggregate `Them` represents multiple independently
  identified voices.
- `Unknown`, `Me`, and legacy local-speaker labels remain ineligible in this
  change.
- Existing revision-conflict, loading, sampling, and persistence errors retain
  their current presentation.

## Implementation boundaries

- Centralize reviewable-speaker selection so the header, transcript click target,
  modal, and legacy identity controls use the same rule.
- Extend sample interval eligibility narrowly from `Remote Speaker N` to `Them`.
- Do not change final transcription, diarization thresholds, canonical labels,
  database schema, or identity-binding storage.

## Verification

Focused tests must prove:

- A meeting with only `Me` and `Them` reports one unidentified speaker.
- The header opens review for `Them`.
- Clicking `Them` in the transcript opens review for `Them`.
- Saving a person binding for `Them` projects the person's name without changing
  canonical transcript JSON.
- A safe System-audio sample can be selected for `Them`; missing safe audio does
  not block identification.
- Meetings with `Remote Speaker N` retain the existing numbered-speaker flow and
  do not also expose aggregate `Them`.
- `Unknown`, `Me`, and legacy local-speaker labels remain excluded.
