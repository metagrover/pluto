### Keep meeting-note editing responsive and recoverable

- **Issue:** [#748](https://github.com/metagrover/pluto/issues/748)
- **PR:** Direct push to `master`.
- **Changed:** Meeting-note items now enter edit mode before click-position calculation finishes, and added or deleted continuation items update on screen while their save is in flight.
- **Why:** Large rendered notes could make editing feel delayed, while continuation changes were invisible until persistence and refresh completed.
- **Replaced:** Synchronous markdown traversal before opening the editor and waiting for a meeting refresh before continuation changes became visible.
- **Preserved:** Click-to-caret placement, serialized persistence, retry controls, undo behavior, and source-backed note content remain unchanged.
- **Notes:** Failed continuation creation or deletion restores the last saved presentation and exposes the existing retry action.
