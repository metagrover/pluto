# Remote Participant Diarization Design

**Issue:** [#749](https://github.com/metagrover/pluto/issues/749)

## Outcome

Pluto preserves source-backed `Me` attribution while separating multiple people on the system-audio channel into stable meeting-local labels such as `Remote Speaker 1`. A user can bind an anonymous remote label to an existing person or calendar attendee without rewriting the canonical acoustic evidence.

## Architecture

The final transcription path continues to decode microphone and system recordings independently. FluidAudio offline diarization runs only against the system recording; the microphone and system energy windows remain the evidence used by the existing recovered-channel attribution gate. Only segments already accepted as system-origin `Them` are eligible for remote-cluster labels, so diarization cannot promote remote audio to `Me` or resolve an ambiguous simultaneous turn.

Parakeet word timestamps are intersected with system-only diarization intervals. Words touched by more than one established speaker stay anonymous, even when one overlap is longer. Zero-duration punctuation remains attached to the preceding word without affecting confidence. Clusters are numbered by first supported appearance, making labels deterministic for the saved meeting. A cluster with less than one second of total evidence is treated as a short-utterance artifact and does not create a new identity. At least two supported clusters and 80 percent supported system-speech coverage are required before anonymous labels are published. Otherwise the transcript remains `Them`, with a content-free fallback reason in speaker-attribution metadata.

## Identity Resolution

Anonymous labels remain the canonical transcript evidence. Meeting-scoped identity bindings project a confirmed person's name across every rendered turn immediately and persist through the existing identity store. The transcript's speaker-identity disclosure offers linked calendar attendees as direct choices. Selecting an attendee is an explicit user confirmation; duplicate attendee names and ambiguous same-name people are not offered as a one-click match.

This slice does not create automatic voice profiles or infer names from conversational cues. Those can build on the anonymous cluster and confirmed-binding boundary later without weakening source trust.

## Failure And Privacy Boundaries

- Diarization receives only the local system-audio file and runs in the checksum-pinned CoreML runtime.
- `Me` and `Unknown` segments are never relabeled by remote clustering.
- Missing, single-speaker, short-lived, or low-coverage cluster evidence falls back to `Them` without failing an otherwise valid transcript.
- User identity bindings are reversible and do not mutate raw speaker labels.
- No audio, embeddings, transcript content, or identity data is sent to a network service.

## Verification

Tests cover system-only native routing, deterministic cluster numbering, word-boundary alignment, overlap preservation, short-cluster smoothing, low-confidence fallback, finalization persistence, calendar attendee choices, and immediate meeting-wide display projection. Existing full TypeScript, Biome, Swift, renderer, Electron, and transcript-integrity checks remain required before the PR is raised.
