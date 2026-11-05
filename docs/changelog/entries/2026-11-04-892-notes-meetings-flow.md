### Notes as prep, note suggestions, answer actions and "came up" marks

- **Issue:** Notes, meetings, people and Ask Pluto journeys for PR #892.
- **PR:** [#892](https://github.com/metagrover/pluto/pull/892)
- **Changed:** A note chosen for an upcoming meeting is linked to its prep instead of copied, so later edits show there; the recording rail offers a recently edited note about the meeting or its people; Ask Pluto answers can become a to-do or a "Next time with …" item; Ask Pluto and search read notes added after a meeting; "Next time with …" items say when they came up in the latest meeting with that person.
- **Why:** Copies drifted from their notes, notes written after a meeting were invisible to questions and search, and nothing closed the loop on what was raised.
- **Replaced:** Copying a note's text into prep notes. Prep now keeps note ids in `meeting_prep.note_ids_json` (migration `0021_prep_notes`).
- **Notes:** "Came up in" uses word matching on the transcript and skips notes edited after the meeting began.
