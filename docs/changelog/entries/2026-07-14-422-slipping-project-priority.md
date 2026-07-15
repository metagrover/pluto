### Prioritize slipping projects in the Execution brief

- **Issue:** [#422](https://github.com/metagrover/pluto/issues/422)
- **PR:** Pending.
- **Changed:** The Projects execution brief now sorts slipping project cards ahead of at-risk and on-track work while preserving the existing order inside each health bucket.
- **Why:** Pluto already classifies overdue commitments as slipping inside `ProjectsExecutionTab`, but the card list still followed source order. That let a project with overdue work sit below routine commitments even after Pluto had identified it as the most urgent project to review.
- **Replaced:** Showing routine on-track projects before slipping ones when both were present in the same execution brief.
- **Notes:** This stays scoped to project-card ordering in `ProjectsExecutionTab`. Inbox counts, due badges, task ordering inside cards, and broader prioritization logic remain on their existing paths.
