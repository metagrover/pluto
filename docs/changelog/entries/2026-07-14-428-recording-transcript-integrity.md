### Validate completed recording transcripts before creating intelligence
- **Issue:** [#428](https://github.com/metagrover/pluto/issues/428)
- **PR:** Pending.
- **Changed:** Completed recordings now receive full-session mic, system, and mixed-source transcript validation before Pluto creates summaries or knowledge. Live transcription warns when local speech coverage falls behind, and preserved local audio can be retried from Meeting View.
- **Why:** Sparse live chunks could previously produce a saved transcript that omitted captured speech while still appearing complete.
- **Replaced:** Heuristic-only finalization that could publish incomplete meeting intelligence and remove recovery artifacts after an error.
- **Notes:** Integrity evidence is content-free, recording artifacts remain local, and all repository examples use synthetic meeting data.
