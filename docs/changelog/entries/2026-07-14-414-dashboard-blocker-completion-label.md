### Use blocker-specific completion wording in homepage action insights
- **Issue:** [#414](https://github.com/metagrover/pluto/issues/414)
- **PR:** Pending.
- **Changed:** Homepage action-insight cards now use `Resolve blocker` for the primary completion control when the linked attention item is an active blocker, while routine cards keep the existing `Mark complete` wording. Focused dashboard render coverage proves both the blocker-specific and generic label paths.
- **Why:** `#61` is supposed to keep follow-up accountability states explicit across Pluto surfaces. Before this slice, the homepage could already mark an action-insight card as a blocker and show blocker-specific dismiss/snooze controls, but the primary completion affordance still flattened back to routine work copy.
- **Replaced:** Treating blocker-backed homepage follow-ups as if their primary completion action were identical to routine work even while the rest of the card stayed blocker-specific.
- **Notes:** This stays scoped to homepage action-insight completion wording and does not change completion behavior, ranking, or secondary controls.
