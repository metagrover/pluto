### Keep live transcripts readable and in view
- **Issue:** [#599](https://github.com/metagrover/pluto/issues/599)
- **PR:** [#600](https://github.com/metagrover/pluto/pull/600)
- **Changed:** The recording transcript now follows accepted speech until the user scrolls away, offers a Return to live control, and reads consecutive same-speaker segments as one stable turn.
- **Why:** Backend segment boundaries should not interrupt a sentence or force users to manually chase the conversation during a meeting.
- **Replaced:** The renderer's misleading Following live label and one-row-per-ASR-segment presentation.
- **Notes:** Grouping is presentation-only; canonical transcript evidence, timestamps, persistence, and finalization are unchanged.
