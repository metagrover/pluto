### Design Asynchronous Memory Dreaming and Knowledge Consolidation Engine
- **Issue:** [#586](https://github.com/metagrover/pluto/issues/586)
- **PR:** [#587](https://github.com/metagrover/pluto/pull/587)
- **Changed:** Created comprehensive design spec for Pluto's offline Memory Dreaming Engine. The design specifies an Electron-managed idle and manual background process that extracts dirty entity clusters, performs temporal state reconciliation, deduplicates entity nodes, re-synthesizes narrative profiles across meetings, and logs diffs to a user-inspectable Dream Log Drawer in the Knowledge Workspace.
- **Why:** Point-in-time post-meeting extraction leaves knowledge fragmented, creates conflicting temporal quotes across meetings, and accumulates duplicate graph nodes over time.
- **Replaced:** Static per-meeting entity extraction without cross-meeting synthesis or temporal reconciliation.
- **Notes:** All background modifications are auto-applied with single-click user revert capability via the Dream Log Drawer.
