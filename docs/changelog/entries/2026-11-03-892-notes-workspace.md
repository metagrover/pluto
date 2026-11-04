### Notes workspace and Ask Pluto in notes

- **Issue:** Standalone notes for PR #892.
- **PR:** [#892](https://github.com/metagrover/pluto/pull/892)
- **Changed:** Add a Notes workspace with a block editor: slash commands, block menu, drag to reorder, multi-block selection, note-wide undo and redo, and serif titles. Notes link to a person or project, and `[task: …]` lines sync with Tasks while checklists stay in the note. Ask Pluto (⌘J) answers from the open note, can focus on selected text or blocks, inserts answers, and adds suggested tasks only after the user approves them.
- **Why:** Notes, tasks and AI answers belong in one place, and editing had to keep focus and the cursor through autosave and block changes.
- **Replaced:** Note tables created when the store loaded, and unused note links written into `entity_links`. Notes now come from migration `0020_notes`, and a note's person or project link lives in `notes.target_id`.
- **Notes:** Older databases that already have a `notes` table keep their rows; missing columns are added before the migration runs. When memory protection refuses the main local model, note answers use the quick model and say so.
