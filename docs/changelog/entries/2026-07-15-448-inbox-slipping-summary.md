### Surface slipping state in inbox triage summary

- **Issue:** `#448`
- **PR:** `(pending)`
- **Changed:** The Projects execution Inbox badge now switches to `N overdue` whenever unassigned commitments are already overdue, while routine inbox work keeps the existing `N to triage` wording.
- **Why:** Pluto already treats overdue work as slipping in the execution heading, detail line, and project-card summaries, but the inbox badge still flattened overdue unassigned work into routine triage copy. This keeps the remaining ungrouped-work summary honest without broadening the surface.
- **Replaced:** Treating slipping inbox work as generic `N to triage`.
- **Notes:** This stays scoped to the inbox summary badge. Execution ordering, project-card summaries, and completed-item disclosure behavior remain unchanged.
