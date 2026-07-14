### Complete overdue execution tasks from the checkbox
- **Issue:** [#410](https://github.com/metagrover/pluto/issues/410)
- **PR:** [#411](https://github.com/metagrover/pluto/pull/411)
- **Changed:** The Projects execution brief now marks overdue tasks `completed` when you check them off, matching the existing active-task completion flow while keeping completed-task reopen behavior intact. Focused regression coverage now proves the overdue checkbox path directly.
- **Why:** `#61` depends on lifecycle controls that users can trust. Before this fix, the execution brief showed overdue tasks as open commitments but clicking their checkbox silently reset them to `active`, which made the surface undo the intended completion transition.
- **Replaced:** Treating overdue execution tasks as if checking them off should reopen them to `active`.
- **Notes:** This stays scoped to `ProjectsExecutionTab` toggle behavior. Ranking, layout, inbox wording, and follow-up draft work stay on their existing paths.
