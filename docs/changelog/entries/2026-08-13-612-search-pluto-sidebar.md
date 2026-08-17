### Add Search Pluto to the sidebar

- **Issue:** `#612`
- **PR:** `(pending)`
- **Changed:** The sidebar now exposes a compact Search Pluto launcher directly above Start recording, using `⌘P` to open a grouped search overlay for projects, people, and meetings. Project and person selections now preserve their entity IDs, entity lookup is debounced and sequenced, and result groups are capped.
- **Why:** Users need a fast, visible way to find project, people, and meeting context by name before asking deeper questions or navigating through memory surfaces.
- **Replaced:** Hidden or meeting-only search entry points that made project and people discovery depend on already knowing where to look.
- **Notes:** This slice stays scoped to search and navigation. Scoped Ask Pluto answers remain a later issue #612 follow-up. Post-merge review follow-up added DOM-level navigation coverage for exact project/person selection and stale search responses.
