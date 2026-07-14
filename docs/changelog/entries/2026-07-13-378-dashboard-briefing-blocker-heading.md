### Surface blocker state in overdue and stale briefing headings
- **Issue:** [#378](https://github.com/metagrover/pluto/issues/378)
- **PR:** [#379](https://github.com/metagrover/pluto/pull/379)
- **Changed:** The homepage briefing-focus heading now switches to `Blocked follow-up` when the prioritized overdue or stale follow-up is blocker-backed, while routine overdue/stale summaries keep the existing `Needs attention` title. Focused dashboard model regression coverage now proves both blocked urgent paths and the generic fallback.
- **Why:** `#61` still depends on homepage follow-up surfaces classifying blocker-backed work differently from routine attention. Before this slice, Pluto could already promote a blocked overdue or stale follow-up into the hero and briefing slot, but the briefing heading still flattened that state back to generic attention copy.
- **Replaced:** Treating blocker-backed overdue and stale briefing focus as generic attention copy even after blocker-aware selection logic had already chosen that work.
- **Notes:** This intentionally stays scoped to briefing heading/title copy and does not overlap the separate richer blocker-detail or blocker-CTA slices already in flight for overdue and stale briefing focus.
