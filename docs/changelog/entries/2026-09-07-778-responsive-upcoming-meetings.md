### Show more upcoming meetings at a glance

- **Issue:** [#778](https://github.com/metagrover/pluto/issues/778)
- **PR:** [#779](https://github.com/metagrover/pluto/pull/779)
- **Changed:** The dashboard now reads the bounded forward calendar cache, keeps `No meetings today` visible when appropriate, and continues with dated future meetings. Its collapsed agenda shows three rows in compact windows and five in the larger layout, with overflow behind an accessible `More` disclosure.
- **Why:** A today-only query hid every later meeting, while the fixed two-row limit hid too much of a busy agenda.
- **Replaced:** The midnight-to-midnight dashboard query, the fixed two-row collapsed limit, and the less direct `No more meetings today` copy.
- **Notes:** Calendar synchronization, ordering, recovery states, and Pluto's existing visual language are unchanged.
