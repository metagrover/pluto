### Make Meetings calmer to scan and read

- **Issue:** [#687](https://github.com/metagrover/pluto/issues/687)
- **PR:** Not created; issue branch implementation.
- **Changed:** The Meetings index now uses a clearer chronology, larger primary and secondary text, stronger keyboard states, and a quieter empty state. Meeting notes, transcripts, and source evidence share a more legible type scale, reading measure, spacing rhythm, and responsive hierarchy in light and dark themes.
- **Why:** Meeting titles, timestamps, transcript turns, and supporting evidence relied on small or faint text and inconsistent rhythm, which made context re-entry harder during long reading sessions.
- **Replaced:** Decorative empty-state treatment, very low-emphasis list metadata, mismatched display and editing typography, cramped transcript rows, and a full-width evidence overlay on wide windows.
- **Notes:** Navigation, deletion protections, note editing, transcript processing, persistence, analysis, and evidence semantics are unchanged. The evidence pane remains a bottom sheet on narrow windows and becomes a focused side sheet on wider windows.
