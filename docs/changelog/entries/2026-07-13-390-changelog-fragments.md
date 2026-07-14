### Replace shared changelog edits with per-PR fragments
- **Issue:** [#390](https://github.com/metagrover/pluto/issues/390)
- **PR:** Pending.
- **Changed:** Meaningful Pluto changes now add uniquely named journal fragments with validation and deterministic assembly commands. CI validates every fragment, and contributor guidance points new work to the fragment workflow.
- **Why:** Parallel branches repeatedly inserted adjacent entries into the newest section of one shared Markdown file, turning otherwise independent pull requests into mechanical merge-conflict repairs.
- **Replaced:** Editing `docs/CHANGELOG.md` directly in every meaningful feature branch and relying on manual conflict resolution to preserve adjacent entries.
- **Notes:** Existing journal history remains archived in `docs/CHANGELOG.md`. Ordinary pull requests must not commit assembled aggregate output; use `pnpm run changelog:build` when a combined post-migration view is needed.
