### Prefer live project attention in Knowledge
- **Issue:** [#403](https://github.com/metagrover/pluto/issues/403)
- **PR:** [#405](https://github.com/metagrover/pluto/pull/405)
- **Changed:** Project-scoped Knowledge `Needs Attention` now prefers matching active durable attention items when the queue already links them to the same project stream, instead of always falling back to older snapshot, doc, or project-card heuristics. Focused regression coverage now proves project stream matches win while streamless project docs still fall back safely.
- **Why:** `#81` is supposed to make Knowledge consume durable attention state instead of rebuilding isolated fallback lists. Before this slice, project docs could stay anchored to stale risk or card text even when Pluto already had fresher active attention for the same live stream in the queue.
- **Replaced:** Treating project Knowledge `Needs Attention` as doc, snapshot, or project-card-only fallback state even when active queue items already matched the project's stream identity.
- **Notes:** This intentionally stays scoped to `project` queue matching. Global, person-context, and team-tracker behavior stays on the existing live-queue paths.
