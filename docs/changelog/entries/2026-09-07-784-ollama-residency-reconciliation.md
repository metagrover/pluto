### Reconcile retained Ollama models before local generation

- **Issue:** [#784](https://github.com/metagrover/pluto/issues/784)
- **PR:** Pending.
- **Changed:** Query Ollama's bounded process-residency endpoint inside serialized local-inference admission, retain an equivalent target model, and unload deduplicated non-target residents before generation.
- **Why:** Ollama's one-hour keep-alive survives Pluto process restarts, while Pluto's previous active-model record existed only in process memory and could miss a stale resident model during a switch.
- **Replaced:** Process-local active-model tracking as the authority for deciding whether a local model switch requires cleanup.
- **Notes:** Model selection, the one-hour target keep-alive, and best-effort explicit/background cleanup remain unchanged.
- **Behavior:** Required residency discovery and switch cleanup share a 40-second overall deadline and fail closed with explicit provider errors; cancellation and preemption still propagate, while explicit background model cleanup remains best effort.
