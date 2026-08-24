### Make finalized transcripts readable without rewriting evidence

- **Issue:** [#659](https://github.com/metagrover/pluto/issues/659)
- **PR:** Pending.
- **Changed:** Meeting View and downstream analysis now use one derived readable transcript that suppresses unambiguous `um` and `uh` tokens, exact duplicates, and strictly gated embedded one-letter artifacts.
- **Why:** Validated Parakeet transcripts could remain fragmented and filler-heavy after strong cross-channel playback had already been reconciled.
- **Replaced:** Raw canonical transcript text as the direct presentation and analysis input.
- **Notes:** Persisted canonical transcript text, timing, word arrays, audio evidence, and provenance remain unchanged; new finalizations store content-free readability counts separately from integrity status.
