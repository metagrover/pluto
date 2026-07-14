### Surface blocker CTA in homepage overdue and stale briefing focus
- **Issue:** [#376](https://github.com/metagrover/pluto/issues/376)
- **PR:** [#377](https://github.com/metagrover/pluto/pull/377)
- **Changed:** The homepage briefing-focus panel now switches its CTA to `Review blockers` when the current overdue or stale focus is already blocker-backed, while routine overdue and stale summaries keep the existing `Review actions` label. Focused dashboard model regression coverage now proves both overdue and stale blocker-backed briefing paths.
- **Why:** `#61` still depends on homepage follow-up surfaces classifying blocker-backed work consistently. Before this slice, Pluto could already surface blocker-specific hero copy and blocker-specific active briefing CTA, but overdue and stale briefing focus still routed users through generic review language even when the same follow-up was clearly marked as blocked.
- **Replaced:** Treating overdue and stale homepage briefing CTA copy as generic action review text even when linked blocker attention had already escalated the surfaced follow-up.
- **Notes:** This intentionally stays scoped to briefing-focus CTA copy and does not reopen the separate overdue/stale heading or blocker-reason slices already tracked in adjacent PRs.
