### Surface slipping state in the execution brief heading

- **Issue:** `#427`
- **PR:** `(pending)`
- **Changed:** The Projects execution brief now switches its top-level heading to `Slipping commitments` whenever overdue work is present, while routine active work keeps the existing `Work in motion` framing and empty/completed-only states stay unchanged.
- **Why:** Pluto already counts overdue commitments, marks slipping project health, and is landing focused ordering work in adjacent PRs, but the first line of the execution view still flattened overdue work into routine active copy. This change keeps the first viewport honest about stalled commitments without broadening beyond header state.
- **Replaced:** Treating overdue execution work as generic `Work in motion` in the heading.
- **Notes:** This stays scoped to the execution heading state. Counts, task ordering, due badges, and project-card ranking remain on their existing issue tracks.
