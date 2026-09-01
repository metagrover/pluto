### Make People a useful relationship briefing

- **Issue:** [#720](https://github.com/metagrover/pluto/issues/720)
- **PR:** Pending.
- **Changed:** People now prioritizes current relationship reads and open loops, shows freshness and evidence status, separates verified ownership from assignee-name candidates, and keeps low-context identities and conversation history behind progressive disclosure.
- **Why:** Placeholder people, hidden current-read data, missing expectations, and expanded empty sections made the page feel like an unfinished entity browser instead of a useful re-entry surface.
- **Replaced:** Flat recency-only people rows, strict all-or-nothing insight display, silent omission of name-matched owner candidates, and three always-expanded empty history groups.
- **Trust boundary:** Placeholder labels are rejected and hidden without deleting evidence. Mention-backed context is labeled as provisional, and extracted owner names require an explicit `Confirm owner` action before they become authoritative.
- **Notes:** Sparse profiles retain an honest empty state, stale briefs remain visible with a refresh disclosure, and source meetings stay directly inspectable.
