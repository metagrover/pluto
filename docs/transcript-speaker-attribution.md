# Transcript speaker-attribution contract

**Issue:** [#663](https://github.com/metagrover/pluto/issues/663)  
**Status:** Active  
**Applies to:** Saved finalized transcript reading and downstream meeting analysis

## Purpose

Pluto must not equate microphone capture with the local speaker. Laptop loudspeakers can leak remote speech into the microphone, causing the same utterance to be decoded twice: once cleanly from System audio and once imperfectly from mic audio. The saved reading projection must prefer trustworthy evidence, avoid false `Me` claims, and keep the transcript used for analysis identical to the transcript shown to the user.

This is a presentation contract. It does not rewrite or replace the persisted canonical transcript.

## Evidence hierarchy

Apply these rules in order:

1. **Confident acoustic or diarization mapping wins.** When `speakerAttribution.mappingApplied` is `true`, preserve the stored `Me` and `Them` labels.
2. **System audio is authoritative remote evidence.** A stored System-channel row remains `Them`.
3. **Matching mic echo is suppressed.** When a mic row materially overlaps System speech and the normalized words satisfy the cross-channel duplicate policy, omit the mic copy from the readable projection and retain the System `Them` row.
4. **Material unmatched overlap follows System authority.** When at least 50 percent of a mic row is covered by System-channel intervals but its words do not satisfy the duplicate policy, retain its words and present the row as `Them`. This covers degraded or phonetic echo such as a proper noun decoded differently on the mic channel.
5. **Independent substantive mic speech may be `Me`.** A valid-timed mic row with less than 50 percent System overlap and at least four words is presented as `Me`.
6. **Insufficient evidence stays neutral.** Short isolated mic rows, missing timing, malformed timing, and unknown labels are presented as `Speaker`.

System overlap is calculated as the union of all overlapping System intervals, so adjacent or nested rows cannot undercount remote coverage.

## Cross-channel echo matching

The saved projection reuses `isCrossChannelDuplicatePair` from `src/utils/speakerAttribution.ts`. A candidate must first overlap at least 45 percent of the shorter row. It is then considered duplicate evidence when one of the following holds:

- normalized text is exact;
- a sufficiently long row contains most of the other row;
- token-set similarity is at least 0.56;
- ordered-prefix similarity is at least 0.60; or
- token-set similarity is at least 0.48 with at least 60 percent temporal overlap.

The matcher also evaluates the combined text of adjacent overlapping System rows. This prevents one mic echo spanning several remote row boundaries from escaping reconciliation.

Normalization lowercases text and removes punctuation before comparison. Any change to normalization or thresholds must update this document and the executable contract suite in the same change.

## Consumer invariant

`buildTranscriptSegmentsForPresentation` is the single saved-transcript projection used by both:

- `MeetingView`, for the transcript the user reads; and
- `buildAnalysisTranscriptFromJson`, for meeting analysis and regeneration.

Consumers must not independently reproduce readability cleanup, echo suppression, or speaker mapping. The projection may remove presentation duplicates and change displayed labels, but it must not mutate:

- persisted `transcript_json`;
- canonical words or timestamps;
- raw channel provenance;
- transcript-integrity evidence; or
- caller-owned segment objects.

## Model setting versus channel-reconciliation failures

Diagnose the failing layer before changing Parakeet:

- If the clean System row is wrong, investigate ASR vocabulary, model, audio quality, or decoding behavior.
- If the System row is correct and an overlapping mic row contains a degraded version, treat it as loudspeaker echo and fix reconciliation.
- If `speakerAttribution.mappingApplied` is `false`, channel fallback explains why raw mic rows were initially labeled `Me`; it does not prove that the user spoke them.
- Vocabulary hints may improve a proper noun, but they cannot remove a duplicate mic-channel decode.

## Known limitation and completion boundary

Timing and text can minimize false `Me` claims, but they cannot prove who spoke during genuine double-talk. Until Pluto has validated near-end acoustic or echo-residual evidence, materially overlapping mic speech follows System authority as `Them`. This intentionally prefers a false-remote label over a false-local claim.

The attribution problem is fully resolved only when a production-validated near-end evidence path can identify real local interruptions without increasing false-`Me` duration. That work remains governed by the diarization-first design and its private benchmark. This presentation contract is the safe fallback, not a substitute for acoustic evidence.

## Executable acceptance matrix

`tests/unit/transcriptSpeakerPresentation.contract.test.ts` must cover:

- authoritative System rows;
- substantive non-overlapping mic speech;
- the exact 50 percent overlap boundary;
- matching loudspeaker echo suppression;
- degraded or phonetic overlap retained as `Them`;
- echo split across adjacent System rows;
- genuine different-word overlap retained without a false `Me` claim;
- short, missing-time, malformed-time, and legacy-timing cases;
- confident mapped attribution precedence;
- raw-evidence immutability; and
- saved-display and analysis parity.

Fixtures must be synthetic. Private meeting words, titles, identities, audio paths, and participant information must not be committed.

## Related designs

- [Diarization-first speaker attribution](superpowers/specs/2026-07-17-diarization-first-speaker-attribution-design.md)
- [Live meeting trust repair](superpowers/specs/2026-08-25-live-meeting-trust-repair-design.md)
- [Readable finalized transcripts](superpowers/specs/2026-08-24-readable-finalized-transcripts-design.md)
