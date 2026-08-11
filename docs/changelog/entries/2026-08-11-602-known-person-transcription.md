### Use relevant known-person context during local transcription

- **Issue:** [#602](https://github.com/metagrover/pluto/issues/602)
- **PR:** [#607](https://github.com/metagrover/pluto/pull/607)
- **Changed:** Pluto snapshots explicit participants plus a bounded deterministic set of linked person entities at recording start and passes the sanitized name-only prompt to local MLX transcription for the meeting.
- **Why:** Acoustically similar common words could replace names Pluto already knew even though the local recognizer supports vocabulary context.
- **Replaced:** Context-free name recognition and error diagnostics that could echo backend exception text.
- **Notes:** Selection is limited to 12 names and 240 prompt characters; the transcript remains raw ASR evidence with no unconditional replacement. Persisted and logged provenance contains only policy version and hint count. Synthetic replay improved the confusable-name case with zero name insertion in the unrelated-speech control.
