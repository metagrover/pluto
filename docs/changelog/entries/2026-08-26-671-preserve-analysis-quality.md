### Preserve trustworthy long-meeting analysis
- **Issue:** [#671](https://github.com/metagrover/pluto/issues/671)
- **PR:** Pending.
- **Changed:** Long local meeting analyses discard generic empty-analysis prose when substantive topics exist, preserve grounded commitments during deterministic compaction, keep tentative and ambiguous language honest, and show a calm notice when consolidation or commitment verification is limited.
- **Why:** A valid notes document could still omit explicit follow-ups, overstate tentative discussion, or present limited synthesis without warning.
- **Replaced:** Oversized analysis treated canned absence summaries as ordinary content and kept quality limitations only in internal generation metadata.
- **Notes:** Exact transcript-evidence requirements remain unchanged. Degraded but usable notes stay available, and no persisted meeting records are mutated by this change.
