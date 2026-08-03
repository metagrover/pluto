### Complete interrupted transcript coverage repair
- **Issue:** [#559](https://github.com/metagrover/pluto/issues/559)
- **PR:** [#561](https://github.com/metagrover/pluto/pull/561)
- **Changed:** Interrupted recording recovery now retries a structurally valid empty checkpoint when persisted activity evidence says that source contains otherwise-unaccounted speech, records the targeted retry outcome, and rebuilds the acceptance frame before sealing.
- **Why:** The finalization planner could request short-interval coverage repair that the recovery executor never performed, leaving an otherwise recoverable meeting in the `stopping` state on every launch.
- **Replaced:** Treating every structurally valid checkpoint as reusable before consulting the planner's speech-coverage contract.
- **Notes:** Valid cross-source acceptance still avoids duplicate transcription, whole-meeting validation remains fail-closed, and regression evidence contains no private meeting content.
