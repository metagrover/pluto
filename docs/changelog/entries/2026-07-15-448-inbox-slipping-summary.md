### Surface slipping state in the inbox triage summary

- **Issue:** `#448`
- **PR:** `(pending)`
- **Changed:** The Projects execution brief inbox badge now switches from routine `N to triage` wording to `N overdue to triage` whenever unassigned active commitments are already overdue, while routine and empty inbox states keep their existing copy.
- **Why:** Recent `#61` trust slices already made slipping state explicit in the execution heading, detail line, ordering, and project-card summaries, but the inbox still flattened overdue unassigned work into generic triage wording. This keeps the remaining inbox seam honest without broadening beyond summary copy.
- **Replaced:** Treating overdue inbox commitments as routine triage work in the summary badge.
- **Notes:** This stays scoped to the inbox summary wording. Inbox empty-state behavior, completed-item disclosure, and the surrounding execution detail logic remain unchanged.
