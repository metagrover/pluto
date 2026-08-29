### Make Gemma 4 the general local model

- **Issue:** [#681](https://github.com/metagrover/pluto/issues/681)
- **PR:** Not created yet.
- **Changed:** Pluto now defaults all general-purpose local intelligence to `gemma4:12b`, while Quick Ask Pluto and its intent classification default to `phi4-mini:3.8b`. Settings disclose both defaults, current acceptance runners inherit Gemma, and blank configuration no longer selects an arbitrary installed model.
- **Why:** Identity reconciliation inherited the historical Qwen default even though Gemma 4 is the intended all-purpose model, making routing inconsistent and evaluations misleading.
- **Replaced:** The task-independent Qwen default and arbitrary installed-model auto-detection.
- **Notes:** Explicit general and fast-model overrides remain supported. Historical Qwen comparison fixtures are unchanged. This change does not pull models or rewrite live settings.
