### Use blocker-specific completion wording in Meeting View
- **Issue:** [#397](https://github.com/metagrover/pluto/issues/397)
- **PR:** Pending.
- **Changed:** Meeting View action cards now use `Resolve blocker` for follow-ups backed by an active linked blocker attention item, while routine, snoozed, dismissed, and completed cards keep their existing completion wording. Focused `meetingActionItems` coverage now proves the blocker-specific and non-active-blocker paths.
- **Why:** `#61` is supposed to make follow-up accountability states explicit across Pluto surfaces. Before this slice, Meeting View could already show blocker context on a card while still flattening the primary completion affordance back to the generic `Mark complete` copy.
- **Replaced:** Treating blocked Meeting View follow-ups as if their completion action were identical to routine work even when a linked blocker was still active.
- **Notes:** This stays scoped to Meeting View action-card completion wording and does not overlap the separate blocker-specific dismiss/snooze control work already in progress on PR `#396`.
