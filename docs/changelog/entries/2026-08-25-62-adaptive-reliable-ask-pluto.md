### Define a responsive, context-aware Ask Pluto contract

- **Issue:** [#62](https://github.com/metagrover/pluto/issues/62)
- **PR:** Not created yet.
- **Changed:** Approved the staged contract for foreground request reliability, deterministic current-meeting resolution, bounded conversation continuity, adaptive Fast/Deep reasoning, and evidence-backed current-versus-history analysis.
- **Why:** Ask Pluto can appear stuck behind local background generation and currently lacks the conversation and meeting scope required to answer follow-ups or comparisons reliably.
- **Replaced:** A single non-streaming request with an unexplained loader, no cancellation path, no bounded conversation context, and no deterministic meaning for current meeting.
- **Notes:** Current meeting means the active recording, otherwise the most recently started persisted meeting even when it is still processing. This entry records product direction; implementation ships in independently verified slices.
