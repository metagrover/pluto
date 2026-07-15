### Surface at-risk state in execution project card summaries

- **Issue:** `#449`
- **PR:** `(pending)`
- **Changed:** Projects execution cards now state `N due soon` when a project is in the yellow `At Risk` state, while slipping cards keep foregrounding overdue counts and routine or completed-only cards keep their existing summary wording.
- **Why:** The execution brief already distinguished at-risk projects with a dedicated health badge, but the adjacent summary line still flattened that same state into generic `N open` copy. This change keeps near-term lifecycle risk explicit on each card without broadening beyond summary text.
- **Replaced:** Treating at-risk execution project summaries as routine open-work counts.
- **Notes:** This stays scoped to per-card summary wording. Execution heading/detail copy, overdue handling, project ordering, and due badge styling remain on their existing issue tracks.
