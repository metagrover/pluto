### Add a meeting-wide editorial pass to structured notes

- **Issue:** [#627](https://github.com/metagrover/pluto/issues/627)
- **PR:** [#633](https://github.com/metagrover/pluto/pull/633)
- **Changed:** Short meetings now use one structured analysis pass, while multi-topic meetings receive one bounded meeting-wide editorial pass that can consolidate duplicate topics, produce a factual executive overview, recover transcript-supported decisions and commitments, and normalize high-confidence terminology in the notes. Exact evidence may span up to three adjacent transcript segments.
- **Why:** Topic-by-topic generation preserved long-meeting coverage but could repeat the same discussion, miss cross-topic commitments, enumerate headings instead of summarizing the meeting, and reproduce obvious contextual transcription spellings in user-facing prose.
- **Replaced:** Treating independently generated topic drafts as the final document and requiring every evidence quotation to fit within one transcript segment.
- **Notes:** The canonical transcript is never rewritten. All settled items remain grounded to verbatim transcript evidence, ambiguous terms and speakers stay unresolved, and editorial failure safely returns the local draft with a quality signal. The corrected semantic quality suite passed all three required model seeds with zero false-positive or false-negative hard-gate failures.
