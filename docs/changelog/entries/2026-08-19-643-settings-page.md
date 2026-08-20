### Redesign Settings as a dedicated page

- **Issue:** [#643](https://github.com/metagrover/pluto/issues/643)
- **PR:** [#644](https://github.com/metagrover/pluto/pull/644)
- **Changed:** Moved settings from an overlay modal into a dedicated tab within the main application routing, styled to match the app's Notion-like aesthetic.
- **Why:** The modal felt disconnected, cluttered, and diverged from the cleaner aesthetic of the main dashboard and wiki tabs. It restricted available space for settings and didn't fit the sidebar navigation model.
- **Replaced:** SettingsOverlay modal component.
- **Notes:** Settings is now added to the ActiveTab state, replacing the boolean toggle settingsVisible. Keyboard shortcut `Cmd+,` now navigates to the Settings tab instead of toggling an overlay.
