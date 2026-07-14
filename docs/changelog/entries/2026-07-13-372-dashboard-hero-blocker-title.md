### Keep blocker-backed hero titles explicit for overdue and stale follow-ups
- **Issue:** [#372](https://github.com/metagrover/pluto/issues/372)
- **PR:** [#373](https://github.com/metagrover/pluto/pull/373)
- **Changed:** The homepage hero now uses blocked-item title copy when an overdue or stale follow-up is backed by active blocker attention, while routine overdue and stale hero states keep their existing status-specific counts. Focused dashboard model regression coverage now proves the blocker-specific title path for both richer blocker-detail and generic stale fallback states.
- **Why:** `#61` still depends on Pluto's highest-visibility follow-up surface keeping blocker-backed work explicit from badge through action copy. Before this slice, the hero could already show blocker-specific badge, detail, and CTA text but still title the card as generic overdue or stale debt, which weakened the trust signal at a glance.
- **Replaced:** Treating blocker-backed overdue and stale hero titles as ordinary aging counts even after Pluto had already classified those same follow-ups as blocked.
- **Notes:** This intentionally stays scoped to homepage hero title copy and does not reopen hero ranking, detail, CTA, briefing, or action-insight behavior.
