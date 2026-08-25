### Make the recording loop immediate and trustworthy

- **Issue:** [#664](https://github.com/metagrover/pluto/issues/664)
- **PR:** Not created yet.
- **Changed:** New meeting enters a visible starting state immediately, Finish moves straight to local processing, capture is available after the sealed provisional handoff, and transcript presentation uses bounded reading turns with channel attribution retained wherever segment-level evidence is strong.
- **Why:** Back-to-back meetings must remain recordable while prior notes process, and transcript presentation must support glancing and reading without inventing speaker certainty or promoting fragmented cross-channel output.
- **Replaced:** Silent asynchronous startup, a live timer that continued through finalization, capture diagnostics, redundant meeting-details chrome, unreliable Me/Them presentation, and unbounded same-speaker paragraph merging.
- **Notes:** Final recovered-channel transcription removes microphone bleed that matches authoritative system-channel speech, including echo split across adjacent remote rows. Saved-meeting and analysis views apply the same non-destructive cleanup; system rows remain Them, substantive mic rows with low remote overlap remain Me, and materially overlapping mic rows follow the authoritative system channel as Them unless independent near-end evidence supports Me. Finalized payloads retain the live EOU candidate, and foreground analysis cooperatively preempts active Ollama knowledge synthesis. Related work is tracked in #647 and #663.
