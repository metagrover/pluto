### Searchable combobox and autofill for speaker identification modal

- **Issue:** [#760](https://github.com/metagrover/pluto/issues/760)
- **PR:** Pending.
- **Changed:** Replaced the native browser `<select>` dropdown in `SpeakerIdentificationModal` with a custom searchable combobox and autofill popover portaled to `document.body` with fixed positioning and z-index 1050 to prevent overflow clipping by the modal scroll container and footer. Users can search workspace people in real time by name or alias, select a person to immediately bind and auto-advance, or type a new name and select `+ Create "<name>"` inline. Generic speaker placeholders (`Remote Speaker \d+`, `Speaker \d+`, `Me`, `Them`, `You`, `Unknown`) are filtered out from suggestions and attendee chips, prevented from person entity creation, and purged from legacy database records on startup.
- **Why:** The native OS dropdown interrupted the fast keyboard flow of speaker review, lacked real-time filtering, and required multiple clunky clicks to create a new person. Additionally, generic speaker placeholders were previously capable of leaking into entity records or showing as person suggestions, and absolutely positioned dropdowns were clipped by modal scroll containers.
- **Replaced:** The native `<select id="speaker-person-select">` dropdown inside the speaker identification modal.
- **Notes:** Meets accessibility requirements with ARIA combobox and listbox/option roles, dynamic popover boundary calculations with auto-flip, and custom focus management.

