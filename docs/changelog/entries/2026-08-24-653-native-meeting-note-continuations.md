### Add native meeting-note continuation rows

- **Issue:** [#653](https://github.com/metagrover/pluto/issues/653)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Pressing Enter at the end of an editable note, action, or decision can create a persisted sibling row with the same native presentation and completion behavior.
- **Why:** New meeting-note rows should remain part of Pluto's structured document instead of becoming nested Markdown inside the previous item.
- **Replaced:** Ad hoc multiline list continuation inside a single generated block.
- **Notes:** Focused model, DOM, meeting-view, and sidebar tests cover persistence, focus, completion, and surrounding workspace behavior.
