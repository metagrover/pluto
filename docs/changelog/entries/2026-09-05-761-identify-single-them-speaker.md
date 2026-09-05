### Identify a single aggregate remote speaker

- **Issue:** [#761](https://github.com/metagrover/pluto/issues/761)
- **PR:** Pending.
- **Changed:** Fixed speaker identification for meetings where the remote side is represented as `Them`: the meeting header and transcript now open the existing guided identity review flow without inventing a numbered speaker label. Short isolated System-audio samples are available through the same bounded sample path used for numbered remote speakers.
- **Why:** A healthy one-remote-participant meeting can legitimately remain `Them` because Pluto does not have evidence for multiple distinct remote clusters. That should not prevent the user from identifying the participant.
- **Notes:** Numbered remote speakers still take precedence. Confirmed names remain reversible display projections; canonical transcript labels and diarization thresholds are unchanged.
