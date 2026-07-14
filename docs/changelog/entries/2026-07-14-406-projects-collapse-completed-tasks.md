### Collapse completed project tasks behind disclosure
- **Issue:** [#406](https://github.com/metagrover/pluto/issues/406)
- **PR:** Pending PR creation from `codex/406-projects-collapse-completed-tasks`.
- **Changed:** Project execution cards now keep the default viewport focused on active work. Completed tasks stay behind a per-project disclosure until the user explicitly opens them, and cards with only completed work now explain that the active queue is empty instead of leading with strikethrough history.
- **Why:** `#404` approved Projects as a re-entry briefing led by active commitments, stalled work, and inbox triage. Inline completed rows made finished work compete with the next useful action in the first viewport.
- **Replaced:** Always-expanded completed task rows inside each project card.
- **Notes:** This stays scoped to `ProjectsExecutionTab`. Task toggles, quick add, grouping, and inbox behavior remain on their existing paths.
