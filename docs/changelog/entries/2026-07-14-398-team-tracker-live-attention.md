### Prefer live team-tracker attention in Knowledge
- **Issue:** [#398](https://github.com/metagrover/pluto/issues/398)
- **PR:** [#402](https://github.com/metagrover/pluto/pull/402)
- **Changed:** Team-tracker Knowledge `Needs Attention` now prefers matching active durable attention items when their `related_entity_ids` intersect the tracked `member_entity_ids` for the selected team doc, instead of always falling back to older snapshot or doc heuristics. Focused regression coverage proves the team-member queue path while leaving global, project, and person-context behavior unchanged.
- **Why:** `#81` is supposed to make Knowledge consume durable attention state instead of rebuilding isolated fallback lists. Before this slice, Team views could stay anchored to stale risk text even when Pluto already had fresher active blocker or follow-up items for tracked teammates in the live queue.
- **Replaced:** Treating team-tracker Knowledge `Needs Attention` as doc-or-snapshot-only fallback state even after working-memory snapshots preserved the team membership needed to match live queue items deterministically.
- **Notes:** This intentionally stays scoped to `team_tracker` queue matching. Snapshot persistence, queue ranking, and broader Knowledge UI behavior stay on their existing paths.
