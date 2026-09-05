### Unify Pluto dropdowns around one searchable control

- **Issue:** [#764](https://github.com/metagrover/pluto/issues/764)
- **PR:** [#769](https://github.com/metagrover/pluto/pull/769)
- **Changed:** Pluto now uses one reusable search-select component for person and project selection, profile role and industry suggestions, meeting identity, recording settings, milestone status, and meeting-note templates.
- **Why:** Native selects and one-off comboboxes behaved and looked different across the app, while long people and project lists needed consistent search and keyboard navigation.
- **Replaced:** Bespoke speaker-identification combobox state, native select controls, and browser datalist suggestions.
- **Notes:** Role and industry still accept free text. Small fixed option sets share the same visual and accessibility foundation without showing unnecessary search input.
