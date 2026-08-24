### Make an empty daily briefing useful and stable

- **Issue:** [#658](https://github.com/metagrover/pluto/issues/658)
- **PR:** Not created yet.
- **Changed:** The homepage now distinguishes `Nothing urgent` with proactive suggestions from a genuinely caught-up state, turns suggested commitments into a focused review disclosure, keeps Recent Win visible as an evidence-backed moment or truthful preview, and places latest meeting or Knowledge context beneath it.
- **Fixed:** Background dashboard refreshes keep resolved content visible and no longer flash a global `Refreshing` label.
- **Why:** Nothing urgent should still feel useful without claiming the user is caught up while review work remains, and background processing should not make stable briefing content appear unsettled.
- **Replaced:** Repeated empty Top of mind and My commitments messages, adjacent equal-weight suggestion actions, and the detached global refresh chip.
- **Notes:** Confirmed and suggested commitments retain distinct trust semantics; no ranking, evidence, persistence, or IPC model changed.
