### Harden Meeting Finalization and Evidence-Grounded Analysis

- **Issue:** [#594](https://github.com/metagrover/pluto/issues/594)
- **PR:** [#595](https://github.com/metagrover/pluto/pull/595) and pending analysis-quality PR
- **Changed:** Cancelled late speech-monitoring writes during recording stop, allowed zero-duration active speaker windows to close safely, unified structured-analysis extraction rules, removed unsupported settled items and attribution fields, and added a repeated real-provider quality gate with explicit Ollama thinking and seed controls.
- **Why:** Late capture writes caused false recovery failures, while contradictory prompts and warning-only grounding could present exploratory ideas, hypothetical work, owners, and dates as settled facts.
- **Replaced:** Uncancelled stop-time monitoring, false durability failures, whole-transcript token overlap, retained unsupported fields, implied-decision instructions, model-behavior assumptions, and fixture-only scoring as the model-change gate.
- **Notes:** Meetings finalize normally and settled analysis now requires local transcript evidence. The content-free model preflight retained Phi as the foreground default and Qwen as an idle/background candidate because neither cleared the full release gate.
