### Harden Meeting Finalization and Evidence-Grounded Analysis

- **Issue:** [#594](https://github.com/metagrover/pluto/issues/594)
- **PR:** [#595](https://github.com/metagrover/pluto/pull/595) and [#625](https://github.com/metagrover/pluto/pull/625)
- **Changed:** Cancelled late speech-monitoring writes during recording stop, allowed zero-duration active speaker windows to close safely, unified structured-analysis extraction rules, removed unsupported settled items and attribution fields, added a repeated real-provider quality gate, and promoted Qwen specifically for structured meeting analysis after it cleared that gate.
- **Why:** Late capture writes caused false recovery failures, while contradictory prompts and warning-only grounding could present exploratory ideas, hypothetical work, owners, and dates as settled facts.
- **Replaced:** Uncancelled stop-time monitoring, false durability failures, whole-transcript token overlap, retained unsupported fields, implied-decision instructions, model-behavior assumptions, and fixture-only scoring as the model-change gate.
- **Notes:** Meetings finalize normally and settled analysis now requires local transcript evidence. Qwen passed the three-seed structured-analysis gate; Phi remains the default for other latency-sensitive Ollama tasks, explicit user settings still win, and MLX transcription is unchanged.
