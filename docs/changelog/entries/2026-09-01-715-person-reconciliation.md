### Reconcile duplicate people without losing evidence

- **Issue:** [#715](https://github.com/metagrover/pluto/issues/715)
- **PR:** Pending.
- **Changed:** People profiles can now be renamed, merged into a chosen canonical person, undone immediately, and restored later. Meetings, expectations, speaker confirmations, graph relationships, and person-context processing resolve through the same identity family.
- **Why:** Duplicate person rows fragmented relationship history and made corrections local to one surface instead of fixing the stored identity model.
- **Replaced:** Independent person rows that remained fragmented after a display correction, plus one-surface cleanup that left downstream IDs unresolved.
- **Trust:** Similar names are suggestions only. Pluto silently resolves only names the user previously confirmed through a rename or merge, and ambiguous aliases remain separate.
- **Recovery:** Merges are transactional canonical aliases, not row deletion or evidence rewriting. Original IDs and source associations remain intact so undo restores the prior split.
- **Performance:** The People list remains one bounded summary read. Reconciliation adds no model call and does not compete with recording or foreground intelligence.
- **Notes:** Previously detected names remain hidden matching aliases after rename. Exact-name duplicates receive a restrained review cue, while fuzzy names never merge automatically.
