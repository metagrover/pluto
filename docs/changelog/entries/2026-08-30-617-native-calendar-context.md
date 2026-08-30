### Bring the next two meetings into the dashboard

- **Issue:** [#617](https://github.com/metagrover/pluto/issues/617)
- **PR:** Not created yet.
- **Changed:** Pluto can request native macOS Calendar access, read one selected calendar through EventKit, and show the next two meetings in the dashboard with an inline `See more` reveal. Calendar context appears during recording and on matched meeting records. Recent win moves below upcoming meetings and the previous continuation card is removed.
- **Why:** A hosted Google OAuth client conflicts with Pluto's free, local-first, one-click distribution goal, while calendars already configured on a Mac provide the same context without Pluto operating an authentication service.
- **Replaced:** The empty upper-right dashboard rail and the dashboard continuation card.
- **Notes:** Pluto asks only after an explicit user action. macOS grants full Calendar permission because EventKit has no read-only access tier, but Pluto's native bridge exposes read operations only. The integration stores a bounded minimal cache, preserves provenance, selects one calendar at a time, never edits events, and does not send calendar fields to meeting intelligence prompts.
