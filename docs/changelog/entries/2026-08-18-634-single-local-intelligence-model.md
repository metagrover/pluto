### Use one local intelligence model

- **Issue:** [#634](https://github.com/metagrover/pluto/issues/634)
- **PR:** [#635](https://github.com/metagrover/pluto/pull/635)
- **Changed:** Pluto now uses `qwen3.5:9b` as the single default Ollama model across meeting notes, titles, value signals, entity extraction, knowledge synthesis, and local queries.
- **Why:** A meeting previously switched between Qwen and Phi behind the scenes, which added model swapping and could produce inconsistent terminology across related artifacts.
- **Replaced:** Task-specific default routing between Qwen for structured analysis and Phi for adjacent local intelligence tasks, plus the hidden `ollama_analysis_model` setting.
- **Notes:** Explicit `ollama_model` and legacy `llm_model` overrides still win. Historical Phi benchmark baselines remain comparison evidence, and installed model files are not deleted automatically.
