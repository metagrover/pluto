### Prioritize overdue work in the execution brief
- **Issue:** [#418](https://github.com/metagrover/pluto/issues/418)
- **PR:** Pending.
- **Changed:** The Projects execution brief now sorts explicit `overdue` tasks ahead of routine `active` work while keeping newer items first inside each lifecycle bucket. Project cards and the inbox both lift the most urgent commitments to the top of the active queue without changing completed-history placement.
- **Why:** `#61` depends on Pluto showing the most urgent follow-up state first. Before this slice, the execution brief already classified overdue tasks correctly but could still bury them behind newer routine work, which weakened trust in the lifecycle ordering.
- **Replaced:** Execution ordering that treated `overdue` work like ordinary history and let newer routine active items appear first.
- **Notes:** This stays scoped to `ProjectsExecutionTab` ordering. Summary copy, grouping, toggle behavior, and layout remain on their existing paths.
