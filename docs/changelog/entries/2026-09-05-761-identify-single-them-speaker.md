### Identify a single aggregate remote speaker

- **Issue:** [#761](https://github.com/metagrover/pluto/issues/761)
- **PR:** Pending.
- **Changed:** Fixed speaker identification for meetings where the remote side is represented as `Them`: the meeting header and transcript now open the existing guided identity review flow without inventing a numbered speaker label. Explicit speaker-label improvement also reconstructs sealed System capture with Pluto's current per-chunk normalizer, remixes it with the mic channel, and retranscribes against the repaired timeline before offering voice samples.
- **Why:** A healthy one-remote-participant meeting can legitimately remain `Them` because Pluto does not have evidence for multiple distinct remote clusters. Historical meetings recorded across a System-audio sample-rate change can also retain healthy raw chunks behind a slowed reconstructed track; neither condition should prevent reliable participant identification.
- **Replaced:** Filtering that only treated `Remote Speaker N` labels as reviewable, plus retrying speaker labels against an already-persisted System WAV even when the sealed journal retained healthier source chunks.
- **Notes:** Numbered remote speakers still take precedence. Confirmed names remain reversible display projections; canonical transcript labels and diarization thresholds are unchanged. Raw capture evidence and prior artifacts remain untouched, and reconstruction never substitutes microphone audio for a remote-speaker sample.
