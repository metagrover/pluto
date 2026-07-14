### Surface blocker state in Meeting View follow-up controls
- **Issue:** [#395](https://github.com/metagrover/pluto/issues/395)
- **PR:** [#396](https://github.com/metagrover/pluto/pull/396)
- **Changed:** Meeting View follow-up cards now use `Dismiss blocker` and `Snooze blocker` when the linked active attention item is a blocker, while routine follow-ups and dismissed or snoozed reopen affordances stay unchanged. Focused regression coverage now proves those blocker-specific control labels on mixed-status duplicates and directly linked blocker cards.
- **Why:** `#61` depends on follow-up lifecycle state staying explicit anywhere Pluto asks the user to act on blocked work. Before this slice, Meeting View could already show blocker badges and reasons but still flattened the next action back to generic dismiss and snooze copy.
- **Replaced:** Treating blocker-backed Meeting View follow-up controls as the same generic dismissal actions used for routine follow-ups.
- **Notes:** This stays scoped to Meeting View control copy in `meetingActionItems.ts` and does not change ranking, lifecycle transitions, or homepage behavior.
