### Review suggested commitments with their source context

- **Issue:** [#660](https://github.com/metagrover/pluto/issues/660)
- **PR:** Not created yet.
- **Changed:** Suggestions now use compact single-open rows. The active row shows one line of persisted source synthesis that opens the meeting when clicked, followed by a focused add or dismiss decision. Accepted suggestions move to the top of My commitments with a brief Added acknowledgement. Confirmed rows use one empty completion control, reserve status labels for exceptional states, keep source meetings clickable, and move snooze or dismiss into a secondary action menu.
- **Fixed:** Every pending suggestion in the dashboard queue is visible and reviewable instead of leaving later items behind a non-interactive waiting count. Confirmed suggestions no longer disappear when a shared action-insight cap would otherwise rank them out of the visible commitment list.
- **Why:** People should be able to judge what Pluto heard before adding or dismissing a commitment without leaving the decision flow.
- **Replaced:** Repeated status pills, duplicated completion actions, always-visible snooze and dismiss links, large review buttons, a separate source link, an oversized inline evidence panel, the hidden pending-suggestion count, and repetitive review instructions.
- **Notes:** The renderer does not regenerate synthesis or infer missing evidence; detailed topic and quote evidence stays in the source meeting.
