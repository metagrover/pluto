### Respect explicit overdue status in execution project health
- **Issue:** [#412](https://github.com/metagrover/pluto/issues/412)
- **PR:** [#413](https://github.com/metagrover/pluto/pull/413)
- **Changed:** Project cards in the Execution brief now badge themselves as `Slipping` whenever any linked task is already explicitly marked `overdue`, even if due-date math alone would not have re-derived that state.
- **Why:** `ProjectsExecutionTab` already treats explicit overdue tasks as live overdue commitments, but its health badge could still flatten the same project back to `On Track`. That made Pluto's lifecycle summary contradict its own persisted follow-up status.
- **Replaced:** Project health badges that ignored an explicit `overdue` task state unless the due date also happened to fall before `now`.
- **Notes:** This stays scoped to project health classification in `ProjectsExecutionTab`. Checkbox transitions, grouping, and execution-brief layout remain on their existing paths.
