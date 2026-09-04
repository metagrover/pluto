### Export meeting notes as clean Markdown

- **Issue:** [#744](https://github.com/metagrover/pluto/issues/744)
- **PR:** Pending.
- **Changed:** Upgraded the meeting export action to download a clean, structured Markdown file (`.md`) formatted from the active meeting notes document and calendar context.
- **Why:** The legacy export bundled thousands of lines of raw transcript JSON and internal data into an unstructured `.txt` file, making notes noisy and difficult to use in external markdown tools.
- **Replaced:** The legacy raw `.txt` dump in the meeting actions menu.
- **Preserved:** All user-edited notes, completed action item checkboxes, topic summaries, and calendar attendee metadata are maintained and accurately represented.
- **Notes:** Raw transcript JSON and model generation parameters are strictly excluded from the exported file.
