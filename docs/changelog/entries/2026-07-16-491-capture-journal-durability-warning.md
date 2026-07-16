### Surface capture-journal durability warnings during recording

- **Issue:** [#491](https://github.com/metagrover/pluto/issues/491)
- **PR:** Pending.
- **Changed:** The recording workspace capture-health model now tracks capture-journal durability, and `AudioManager` flips that state to warning when journal start, append, or seal fails.
- **Why:** Pluto should not present active capture as fully trustworthy once acknowledged audio is no longer guaranteed to be crash-recoverable.
- **Replaced:** Console-only journal durability failures that left the live recording surface looking healthy.
- **Notes:** The slice stays scoped to live durability signaling on current `master`; it does not broaden into launch recovery, checksum salvage, or the larger trust-UX work tracked in [#444](https://github.com/metagrover/pluto/issues/444).
