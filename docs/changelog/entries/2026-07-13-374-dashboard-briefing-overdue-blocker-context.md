### Surface blocker context in overdue briefing focus
- **Issue:** [#374](https://github.com/metagrover/pluto/issues/374)
- **PR:** [#375](https://github.com/metagrover/pluto/pull/375)
- **Changed:** The homepage briefing focus now switches to blocker-specific copy when the highest-priority overdue follow-up is backed by active blocker attention. It reuses the richer blocker reason when available, falls back to blocked-item count when that reason is thin, and keeps the existing generic overdue-count copy for non-blocker overdue work. Focused dashboard model regression coverage now proves both the blocker-reason and fallback paths.
- **Why:** `#61` still depends on homepage follow-up surfaces staying consistent about which commitments are truly blocked. Before this slice, overdue hero detail already preserved blocker evidence, but the adjacent briefing focus still flattened the same state into generic `Needs attention` copy, which made one of Pluto's core trust surfaces lag behind the others.
- **Replaced:** Treating blocker-backed overdue briefing focus as generic overdue summary text even when linked active blocker attention already carried the stronger reason Pluto should surface.
- **Notes:** This intentionally stays scoped to overdue briefing focus behavior and does not reopen the in-flight stale briefing or overdue/stale hero trust-copy slices.
