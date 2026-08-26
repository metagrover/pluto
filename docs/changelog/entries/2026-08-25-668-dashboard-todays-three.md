### Make Today's focus a calm, ordered daily ritual

- **Issue:** [#668](https://github.com/metagrover/pluto/issues/668)
- **PR:** Pending.
- **Changed:** The dashboard now leads with the current date and one ordered `Today's focus` list, capped at three priorities. Users can add their own commitment, drag priorities or move them with keyboard controls, and keep that order for the day. The spacious empty state now lives inside the list with a project-owned gender-neutral relaxation illustration. Recent Win only surfaces positive events supported by meeting evidence, while five recorded meetings appears only as an onboarding checkpoint; Celebrate reuses Pluto's reduced-motion-aware confetti.
- **Why:** Separate urgent and daily-priority surfaces created unnecessary cognitive load, while dense bold rows, repeated category labels, and an unbounded suggestion queue made a low-pressure briefing harder to scan.
- **Replaced:** The competing `Top of mind` urgency banner, oversized labeled add button, static commitment order, and multi-item suggestions list.
- **Notes:** Today's ordering is stored as date-scoped metadata on existing action entities. Only confirmed commitments enter the daily three, displaced items remain in the backlog, and evidence-backed wins retain their source provenance.
