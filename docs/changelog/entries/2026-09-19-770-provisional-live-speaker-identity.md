### Add opt-in provisional speaker names during meetings

- **Issue:** [#770](https://github.com/metagrover/pluto/issues/770)
- **PR:** [#840](https://github.com/metagrover/pluto/pull/840)
- **Changed:** Added a default-off local beta that can display precision-gated provisional names on fully covered remote-speaker transcript intervals. Suggestions require continuity across evidence revisions and support confirm, reject and undo. Confirmations are reconciled conservatively against the finalized timed transcript before creating an explicit user identity binding.
- **Why:** Recurring participants can be recognized while a meeting is in progress without changing transcript wording or treating a provisional acoustic match as canonical identity.
- **Replaced:** Live transcripts always remaining anonymous until post-meeting Speaker Review.
- **Safety:** Native analysis uses a bounded in-memory window. Voice embeddings, scores, digests and profile identifiers never enter renderer IPC or transcript data. Analysis failure cannot fail recording, disabling clears live hints, and ambiguous final overlap remains unresolved for review.
- **Notes:** The feature remains off by default because the consented private zero-false-suggestion and concurrent-resource benchmark is not yet run. This change does not alter the separate post-finalization automatic voice-binding policy.
