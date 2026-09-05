### Guided speaker identification modal and meeting header entry point

- **Issue:** [#759](https://github.com/metagrover/pluto/issues/759)
- **PR:** Pending.
- **Changed:** Replaced the cluttered inline collapsible accordion above the transcript with a guided, one-by-one speaker identification modal (`SpeakerIdentificationModal`). Added an interactive metadata entry point directly under the meeting title (`September 5, 2026 · 2 participants · 2 unidentified speakers`) that opens the modal, and wired unresolved `Speaker N` turn badges in the transcript to open the modal pre-focused on that speaker. Each speaker is reviewed sequentially with isolated audio samples, quote snippets, 1-click attendee suggestion chips (filtering out workspace user and nicknames), and person search/create dropdowns. Confirming or clicking an attendee chip auto-advances to the next speaker, with full Back/Skip navigation and a completion review summary. Removed the stacked accordion from the transcript area to keep the reading surface completely clean.
- **Why:** Eliminates visual clutter and cognitive overload from stacking multiple speaker forms and technical system disclaimers in the reading view, and provides an intuitive, high-level entry point under the meeting title to triage speakers in seconds.
- **Replaced:** The inline collapsible speaker review accordion above the transcript.
- **Notes:** Compatible with offline diarization and calendar attendee matching. Preserved all keyboard shortcuts (Esc, Enter, Tab) and accessibility attributes.
