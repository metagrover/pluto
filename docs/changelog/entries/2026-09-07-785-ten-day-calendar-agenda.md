### Make quiet-day calendar cards useful

- **Issue:** [#785](https://github.com/metagrover/pluto/issues/785)
- **PR:** [#786](https://github.com/metagrover/pluto/pull/786)
- **Changed:** The dashboard now refreshes before its initial calendar read, uses a 10-day agenda, shows every remaining meeting today, and otherwise follows `No meetings today` with the next three future meetings in compact layout or five in large layout. `More` reveals the rest of the bounded agenda.
- **Why:** The previously merged future-date presentation could still read before the startup refresh completed, and its uniform row cap did not express the agreed priority between today's complete schedule and the next useful future meetings.
- **Replaced:** The 30-day dashboard query, the initial cache-only read, and the same collapsed row cap for both today's meetings and future meetings.
- **Notes:** Calendar synchronization may retain a wider internal cache for matching and recovery, but the dashboard displays only the selected calendars' 10-day agenda.
