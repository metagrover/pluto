### Design Asynchronous Memory Dreaming and Knowledge Consolidation Engine
- **Issue:** [#586](https://github.com/metagrover/pluto/issues/586)
- **PR:** [#587](https://github.com/metagrover/pluto/pull/587)
- **Changed:** Designed a proposal-first local Memory Dreaming Engine that builds revision-safe evidence clusters, uses a benchmark-selected background model to propose cross-meeting consolidation, validates every proposal deterministically, and exposes review, application, and exact restoration through a Dream Log.
- **Why:** Point-in-time extraction leaves knowledge fragmented and can accumulate conflicting facts or duplicate entities, while giving an unproven model direct graph authority would amplify unsupported inferences into durable memory.
- **Replaced:** The earlier design assumption that all model-generated merges, state changes, summary rewrites, and decay decisions could auto-apply with a lightweight inverse diff.
- **Notes:** `qwen3.5:9b` is the preferred background candidate to benchmark, not a locked default. High-risk changes require review initially; immutable meeting evidence remains untouched; auto-application requires a separate quality gate and complete prior-state restoration.
