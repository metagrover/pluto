### Make post-meeting processing converge without false speech-loss warnings
- **Issue:** [#574](https://github.com/metagrover/pluto/issues/574)
- **PR:** [#575](https://github.com/metagrover/pluto/pull/575)
- **Changed:** Full-channel validation now distinguishes explicit VAD-confirmed silence from ambiguous empty transcription, recording finalization hands validated meetings to one app-wide worker, downstream completion waits for entity extraction and synchronous knowledge refresh, and unavailable local diarization models use the deterministic fallback without a failed request.
- **Why:** Acoustic level windows were treated as proof of speech even after WhisperX found no speech, and processing depended on the selected meeting while analysis and knowledge could be marked complete too early.
- **Replaced:** Selection-triggered recovery, empty-segment inference, inline post-stop analysis, and fire-and-forget knowledge completion.
- **Notes:** Capture gaps, source failures, and ambiguous VAD outcomes remain fail-closed; persisted integrity evidence contains only aggregate source outcomes and durations.
