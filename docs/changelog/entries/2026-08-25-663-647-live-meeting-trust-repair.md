### Restore trustworthy live transcripts and local meeting analysis

- **Issues:** [#663](https://github.com/metagrover/pluto/issues/663), [#647](https://github.com/metagrover/pluto/issues/647), and [#664](https://github.com/metagrover/pluto/issues/664)
- **PR:** Not created yet.
- **Changed:** Live committed text now receives presentation-only capitalization and punctuation, uncertain speaker rows stay neutral, capture becomes available after the sealed provisional handoff, and visible analysis progress follows persisted downstream stages.
- **Fixed:** Foreground meeting analysis cooperatively preempts active Ollama knowledge synthesis and receives a bounded five-minute request window; preempted knowledge work returns to the stale queue instead of being recorded as a failure.
- **Removed:** Capture diagnostics and redundant collapsed meeting-details chrome from the recording rail.
- **Notes:** Raw recognizer text remains the canonical provisional transcript input. Background materialization refreshes the saved meeting without taking focus from a newer recording.
