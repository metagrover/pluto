# Live and final transcript reliability

Status: Implemented for review. Runtime acceptance with a fresh real call remains pending.

## Outcome

Make live speech read in conversation order, keep mutable trailing words safe until a proven boundary, and remove exact cross-channel microphone duplicates without publishing them as additional unknown speakers.

## Existing boundaries

This work builds on Punit's `c49d39c3f` reading-order and speaker-continuity change and `118148fb7` explicit one-person constraint. The pipeline already has per-source queues, recognition revision checks, audio timestamps, acoustic echo evidence, and final source transcription. The implementation changes those existing boundaries rather than adding another processing layer.

## Implementation

1. When an end-of-utterance result leaves one word provisional, keep that tail mutable through continued silence. Commit it only after a later word-start token proves the boundary or meeting finish supplies the final transcript, preserving subword corrections such as `meet` becoming `meeting` without terminating live recognition.
2. Split visible live speech at gaps created by echo suppression, then order each retained piece by its own word time. Keep stable source provenance and retire obsolete projected pieces when a correction is restored.
3. Permit supported echo corrections on compacted history while keeping detailed retained parts bounded.
4. When at least three exact, aligned words occur on microphone and System audio and both activity sources tie, keep the direct System copy. Distinct local wording, short acknowledgements, timing disagreement, and stronger local evidence remain untouched.
5. Enforce the existing 256-token per-row matching bound in the cross-checkpoint path as well as the row matcher.

## Verification

Focused regressions cover native tail commitment at a proven boundary, subword continuation after extended silence, interleaved speech after echo removal, callback-independent ordering, correction restoration, bounded history, and exact duplicate selection. A private replay of the affected 28-minute meeting compares current and changed cleanup using freshly transcribed mic/System recordings and acoustic evidence; private text and recordings remain outside Git.

Before merge, run the focused TypeScript and native suites, TypeScript checking, lint, changelog validation, and diff checks. A fresh application call remains the final runtime acceptance gate; replay and automated checks do not establish production capture quality.

Historical transcript regeneration is separate. Preserve original canonical text and recordings and use the existing guarded retry path only after the general fix is accepted.
