### Restore active recording re-entry

- **Issue:** [#645](https://github.com/metagrover/pluto/issues/645)
- **PR:** Not created; local change pending review.
- **Changed:** The sidebar’s New meeting action becomes Return to recording while a live recording is open in the background.
- **Why:** Leaving the recording workspace must never make an in-progress capture unreachable.
- **Replaced:** The missing header-based active-recording re-entry control on home navigation.
- **Notes:** Returning to the recording restores the active workspace without starting another capture.
