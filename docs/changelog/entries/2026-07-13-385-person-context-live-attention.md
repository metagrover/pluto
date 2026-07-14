### Prefer live person-context attention in Knowledge
- **Issue:** [#385](https://github.com/metagrover/pluto/issues/385)
- **PR:** [#386](https://github.com/metagrover/pluto/pull/386)
- **Changed:** Person-context Knowledge `Needs Attention` now prefers matching active durable attention items when the queue already links them to the selected person, instead of always falling back to older snapshot or doc heuristics. Focused regression coverage now proves the person-linked queue path while leaving global, project, and team behavior unchanged.
- **Why:** `#81` is supposed to make Knowledge consume durable attention state instead of rebuilding isolated fallback lists. Before this slice, People views could stay anchored to stale risk text even when Pluto already had fresher active attention items for that same person in the live queue.
- **Replaced:** Treating person-context Knowledge `Needs Attention` as doc-or-snapshot-only fallback state even when active queue items already matched the selected person directly.
- **Notes:** This intentionally stays scoped to `person_context` queue matching. Project and team Knowledge attention behavior remains on the existing fallback path until separate scope-specific issues decide their matching rules.
