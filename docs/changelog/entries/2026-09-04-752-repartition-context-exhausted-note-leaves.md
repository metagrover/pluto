### Keep long-meeting notes moving after a leaf exhausts context

- **Issue:** [#752](https://github.com/metagrover/pluto/issues/752)
- **PR:** Pending.
- **Changed:** A hierarchical meeting-note leaf now repartitions when its bounded audit repair cannot fit the model context.
- **Why:** A large meeting could complete expensive writer and audit calls, discover that the rejected response made its repair request too large, and then fail the entire notes run deterministically.
- **Replaced:** Terminal `notes_context_exhausted` handling for a splittable leaf after writer or audit generation.
- **Preserved:** Short meetings still use the two-call writer/editor path; transport, parser, semantic, source-grounding, hierarchy-depth, and node-count failures remain bounded and fail closed.
- **Notes:** Repartitioning is local to the failed leaf and uses the existing source-boundary splitter without increasing model context or weakening validation.
