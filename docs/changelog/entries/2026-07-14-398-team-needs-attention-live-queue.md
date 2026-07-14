### Prefer live team attention in Knowledge
- **Issue:** [#398](https://github.com/metagrover/pluto/issues/398)
- **PR:** [#400](https://github.com/metagrover/pluto/pull/400)
- **Changed:** Team-tracker Knowledge `Needs Attention` now prefers matching active durable attention items when the queue already links them to tracked team members, instead of always falling back to older snapshot or doc heuristics. Focused regression coverage now proves tracked-member queue matches win while unrelated queue items still fall back safely.
- **Why:** `#81` is supposed to make Knowledge consume durable attention state instead of rebuilding isolated fallback lists. Before this slice, Team views could stay anchored to stale risk text even when Pluto already had fresher active attention items for the tracked people in the live queue.
- **Replaced:** Treating team-tracker Knowledge `Needs Attention` as doc-or-snapshot-only fallback state even when active queue items already matched tracked team members directly.
- **Notes:** This intentionally stays scoped to `team_tracker` queue matching. Global, project, and person-context behavior stays on the existing paths.
