### Notes as prep, note suggestions, answer actions and "came up" marks

- **Issue:** Notes, meetings, people and Ask Pluto journeys for PR #892.
- **PR:** [#892](https://github.com/metagrover/pluto/pull/892)
- **Changed:** A note chosen for an upcoming meeting is linked to its prep instead of copied, so later edits show there; the recording rail offers a recently edited note about the meeting or its people; Ask Pluto answers can become a to-do or a "Next time with …" item; Ask Pluto and search read notes added after a meeting; "Next time with …" items say when they came up in the latest meeting with that person.
- **Why:** Copies drifted from their notes, notes written after a meeting were invisible to questions and search, and nothing closed the loop on what was raised.
- **Replaced:** Copying a note's text into prep notes. Prep now keeps note ids in `meeting_prep.note_ids_json` (migration `0021_prep_notes`).
- **Notes:** "Came up in" uses word matching on the transcript and skips notes edited after the meeting began.

### Owner lines and the live notes editor

- **Changed:** A checklist line like "Priya: send deck" in any note shows on Priya's "Next time with …" and in prep for meetings with her, labeled "On Priya's list" in the editor; live notes while recording are edited like Notes, with checkboxes, bullets and headings.
- **Why:** Group-meeting notes assign things to people, and those items were only visible inside the note; live notes showed raw `- [ ]` text.
- **Notes:** A first name counts only when no other known person shares it. Tasks still have no owner.

### Slash commands clear what you typed

- **Changed:** Picking any slash command in Notes removes the typed "/…", even a partial one like "/per"; Person and Project swap it for "@" or "#" so typing filters the list. In meeting notes, Task puts the caret inside "[task: ]".
- **Why:** A leftover "/" stayed in the line after choosing Person, Project, Task or Checklist from a partly typed or bare "/".

### Ask about a finished meeting in the side panel

- **Changed:** "Ask Pluto" in a finished meeting's header, or ⌘J, opens the same right-hand panel Notes uses, beside the notes. Answers stream, cited excerpts fold under "View evidence", and "Add as to-do" and "Add to Next time with …" stay.
- **Why:** The floating "Ask about this meeting" box covered the end of the notes.
- **Replaced:** The floating composer on finished meetings. The recording dock keeps it and shares the request logic (`useMeetingAskPluto`).

