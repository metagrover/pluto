### Redesign Settings as a dedicated page

- **Issue:** [#643](https://github.com/metagrover/pluto/issues/643)
- **PR:** [#644](https://github.com/metagrover/pluto/pull/644)
- **Changed:** Moved settings from an overlay modal into a dedicated application tab, then grouped Personal, Meetings, Intelligence, and Advanced controls into four keyboard-accessible horizontal tabs. Only one focused category is visible at a time, while the existing Identity and Calendar setup flows retain their richer inline states.
- **Why:** The modal felt disconnected and restricted available space. As more settings arrived, the replacement page also became a long all-at-once stack that made routine preference changes feel like scanning the entire application configuration.
- **Replaced:** The SettingsOverlay modal component and the later six-section vertical settings stack.
- **Notes:** Settings remains part of the ActiveTab state, and `Cmd+,` navigates to it. Existing settings, defaults, persistence keys, provider behavior, Calendar permissions, recording readiness, and knowledge-reset confirmation are unchanged.
