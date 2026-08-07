### Fix Meeting Finalization Recovery Failure on Meeting End

- **Issue:** [#594](https://github.com/metagrover/pluto/issues/594)
- **PR:** [#595](https://github.com/metagrover/pluto/pull/595)
- **Changed:** Cancelled the speech monitoring animation loop immediately when recording stop is accepted, and allowed zero-duration active speaker windows at recording stop time to close cleanly in `captureActivitySession.ts`.
- **Why:** Every completed meeting was degrading into `Processing needs recovery before this meeting is complete` because uncancelled speech monitoring ticks during async recorder shutdown triggered false durability failures.
- **Replaced:** Uncancelled speech monitoring ticks during recorder stop and latching durability failure on zero-duration active speaker windows at session end.
- **Notes:** Meetings now finalize normally, generating validated transcripts and meeting intelligence cleanly.
