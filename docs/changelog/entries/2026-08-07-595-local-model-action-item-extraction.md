### Local LLM Action Item & Decision Extraction with Evidence Grounding
- **Issue:** [#595](https://github.com/metagrover/pluto/issues/595)
- **PR:** [#595](https://github.com/metagrover/pluto/pull/595)
- **Changed:** Updated meeting analysis prompts and JSON schemas (`getStructuredAnalysisPrompt`, `getTopicAnalysisPrompt`, `ActionItemV3`, `DecisionV3`) to request transcript `evidence` quotes for extracted tasks and decisions. Refactored `applyTranscriptGrounding` in `electron/llm/unifiedProvider.ts` to stop purging action items/decisions based on single-line hardcoded string lists (`"i'll"`, `"send"`, `"draft"`).
- **Why:** Empirical analysis of `pluto.db` revealed a 98.8% failure rate for action item extraction and 96.3% failure rate for decision extraction. Hardcoded keyword filters discarded valid LLM outputs whenever the LLM naturally paraphrased conversational dialogue.
- **Replaced:** Rigid single-line keyword post-filtering (`hasSupportInTranscript` with hardcoded keyword string lists).
- **Notes:** Low-support items now populate error metadata (`unsupported_action_item`, `unsupported_decision`) without stripping the extracted tasks from user-facing notes.
