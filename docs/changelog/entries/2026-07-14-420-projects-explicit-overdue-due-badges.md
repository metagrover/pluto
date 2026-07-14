### Respect explicit overdue status in execution due badges
- **Issue:** [#420](https://github.com/metagrover/pluto/issues/420)
- **PR:** Pending.
- **Changed:** Projects execution task rows now render the due-date pill in overdue styling whenever Pluto has already persisted the task as `overdue`, even if due-date math alone would not have re-derived that state. Date-derived overdue active tasks keep the same warning treatment, while completed rows stay visually subdued.
- **Why:** `#61` depends on lifecycle cues that agree with each other. Before this slice, `ProjectsExecutionTab` could already mark a project as slipping for an explicitly overdue task while the row-level due badge still looked routine, which weakened trust in the execution brief.
- **Replaced:** Neutral due-date pills for tasks that Pluto had already classified as overdue.
- **Notes:** This stays scoped to `TaskRow` overdue presentation in `ProjectsExecutionTab`. Ranking, counts, and task-toggle behavior remain on their existing paths.
