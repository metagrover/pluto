### Surface slipping state in execution project card summaries

- **Issue:** `#436`
- **PR:** `(pending)`
- **Changed:** Projects execution cards now switch their per-card summary line to `N overdue` whenever the project already has overdue commitments, while routine active cards keep the existing `N open` wording and completed-only cards stay unchanged.
- **Why:** Pluto already classifies slipping projects in the health badge and top-level execution heading, but each project card still flattened overdue work into routine `open` copy. This change keeps the project-level lifecycle summary honest without broadening beyond one wording seam.
- **Replaced:** Treating slipping project summaries as generic `N open` copy.
- **Notes:** This stays scoped to project-card summary wording. Execution ranking, inbox summary behavior, and due-badge styling remain on their existing tracks.
