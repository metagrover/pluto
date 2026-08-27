### Make loudspeaker meetings readable live

- **Issue:** [#670](https://github.com/metagrover/pluto/issues/670)
- **PR:** Not created yet.
- **Changed:** Live transcription now reads as one chronological `You` and `Call` conversation, aligns the independent source clocks to the meeting, hides only strongly evidenced microphone echo, shows one muted tentative tail, restores punctuation from committed token pauses, and splits oversized recognition rows into bounded paragraphs.
- **Why:** Duplicated loudspeaker audio and simultaneous unpunctuated `Speaker` blobs made Pluto difficult to follow during the meeting itself.
- **Replaced:** Identical source labels, raw source-local timestamp interleaving, full-strength competing tentative rows, typewriter reveal, one-terminal-mark punctuation, and the floating Return to live control over transcript text.
- **Notes:** Echo suppression and punctuation are reading projections. Raw live source text remains available for provisional persistence, capture-journal evidence is unchanged, ambiguous overlap remains visible, and final canonical reconciliation keeps its existing stricter trust boundary.
