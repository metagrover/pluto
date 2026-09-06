### People briefing section rhythm and row alignment

- **Issue:** [#766](https://github.com/metagrover/pluto/issues/766)
- **PR:** Pending.
- **Changed:** Added explicit section gaps, balanced heading spacing, a fixed identity column on wide People lists, and a bounded metadata column with tabular counts and dates. Narrow lists stack metadata below the person context while preserving all cues.
- **Why:** Keep relationship briefs and recent conversations clearly separated and make rows easier to scan regardless of name length or badge count.
- **Replaced:** Margin-based section spacing and content-sized metadata, including narrow viewport rules that hid context and dates.
- **Notes:** Layout responds to the People panel width. Existing row dividers, selection, hover, and keyboard focus treatments remain in place.
