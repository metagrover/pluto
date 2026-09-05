### Searchable combobox and autofill for speaker identification modal

- **Issue:** [#760](https://github.com/metagrover/pluto/issues/760)
- **PR:** Pending.
- **Changed:** Replaced the native browser `<select>` dropdown in `SpeakerIdentificationModal` with a custom searchable combobox and autofill popover. Users can search workspace people in real time by name or alias, select a person to immediately bind and auto-advance, or type a new name and select `+ Create "<name>"` inline. The combobox features full keyboard navigation (ArrowDown, ArrowUp, Enter), Escape key priority (closing suggestions when open without closing the modal), a clear (×) button, and an active speaker unassign button.
- **Why:** The native OS dropdown interrupted the fast keyboard flow of speaker review, lacked real-time filtering, and required multiple clunky clicks to create a new person.
- **Replaced:** The native `<select id="speaker-person-select">` dropdown inside the speaker identification modal.
- **Notes:** Meets accessibility requirements with ARIA combobox and listbox/option roles and custom focus management.
