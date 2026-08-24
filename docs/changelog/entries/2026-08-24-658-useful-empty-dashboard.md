### Make an empty daily briefing useful and stable

- **Issue:** [#658](https://github.com/metagrover/pluto/issues/658)
- **PR:** Not created yet.
- **Changed:** The homepage now shows one compact caught-up state, promotes suggested commitments, and falls back to a supported win, latest meeting, or Knowledge context instead of repeating empty panels.
- **Fixed:** Background dashboard refreshes keep resolved content visible and no longer flash a global `Refreshing` label.
- **Why:** Nothing urgent should still feel useful, and background processing should not make stable briefing content appear unsettled.
- **Replaced:** Repeated empty Top of mind, My commitments, and unsupported Recent win messages, plus the detached global refresh chip.
- **Notes:** Confirmed and suggested commitments retain distinct trust semantics; no ranking, evidence, persistence, or IPC model changed.
