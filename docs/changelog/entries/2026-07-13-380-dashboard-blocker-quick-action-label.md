### Surface blocker state in homepage follow-up quick actions
- **Issue:** [#380](https://github.com/metagrover/pluto/issues/380)
- **PR:** [#381](https://github.com/metagrover/pluto/pull/381)
- **Changed:** The homepage quick-action row now uses `Review blockers` whenever the surfaced follow-up state is blocker-backed, covering blocked overdue, stale, and active follow-ups while keeping routine project states on `Open projects`. Focused dashboard model regression coverage now proves those blocked and routine quick-action paths alongside the existing spotlight-only blocker behavior.
- **Why:** `#61` still depends on homepage follow-up surfaces keeping blocker state explicit across the full attention loop. Before this slice, the hero and briefing panels could already classify blocked work correctly while the shared projects quick action still flattened that same state back to generic project navigation.
- **Replaced:** Treating action-insight-driven homepage project quick actions as generic `Open projects` navigation even when the selected follow-up state was already blocker-backed.
- **Notes:** This intentionally stays scoped to quick-action copy in `dashboardModel.ts` and does not reopen hero ranking, briefing wording, or spotlight behavior.
