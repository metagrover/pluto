### Make Meeting Notes editing reliable and recoverable

- **Issue:** [#697](https://github.com/metagrover/pluto/issues/697)
- **PR:** Pending.
- **Changed:** Inline Meeting Notes edits now autosave after a short idle period, expose truthful save and retry states, cancel safely with Escape, support keyboard-reachable editing and row navigation, enable native spellcheck, offer an explicit Add item action, and provide Undo after deleting a user-created row.
- **Why:** A document users trust as working memory must not depend on an invisible blur to persist changes, swallow boundary keys, hide failed drafts, or make row creation and recovery discoverable only by accident.
- **Replaced:** Blur-only inline persistence, inert textarea-only navigation, pointer-only edit entry, disabled spellcheck, hidden Enter-only row creation, and irreversible empty-row removal.
- **Notes:** Canonical generated analysis, Markdown checkbox behavior, source evidence, and the existing `native_continuations:<parentPath>` persistence contract remain unchanged. Undo restores only the deleted continuation into the latest saved list so concurrent row changes are not overwritten.
