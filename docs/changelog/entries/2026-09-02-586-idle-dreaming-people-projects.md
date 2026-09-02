### Idle Dreaming and Cross-Meeting Consolidation for People and Projects

- **Issue:** [#586](https://github.com/metagrover/pluto/issues/586)
- **Changed:** Added background idle dreaming for people and project pages. When the system is idle, plugged into AC power, and thermal conditions are nominal, Pluto synthesizes cross-meeting knowledge packages using structured meeting notes (never raw transcripts) and consolidates project milestones, summaries, and alias suggestions. Added instant preemption (<50ms abort via AbortController) on any user activity or pause lock, negative constraints persistence in `entity_corrections` table so deleted/reported items are never re-added, and manual "Dream Now" triggers on People and Project views for immediate testing.
- **Why:** Synthesizing knowledge across meetings in the foreground creates noticeable latency, battery drain, and user disruption. Background idle dreaming consolidates knowledge transparently while ensuring zero-wait page loads and preserving user agency through frictionless additions and negative constraint recording.
- **Replaced:** Eager foreground LLM initiative discovery on page mount.
- **Notes:** Local Ollama execution is bounded structurally (1 entity cluster at a time) rather than by short 20–30s timeouts, yielding instantly to foreground user actions.
