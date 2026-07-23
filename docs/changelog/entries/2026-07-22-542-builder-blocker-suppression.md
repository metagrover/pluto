### Suppress unchanged Builder blocker noise

- **Issue:** [#542](https://github.com/metagrover/pluto/issues/542)
- **PR:** [#543](https://github.com/metagrover/pluto/pull/543)
- **Changed:** Added stable, content-free blocker fingerprints, duplicate-comment suppression, roadmap-safe fallback scanning, and explicit changed-versus-unchanged Builder outcomes.
- **Why:** Scheduled runs were repeating the same human-decision blocker and creating misleading activity without implementation progress.
- **Replaced:** Timestamp-sensitive rediscovery and unconditional blocked-run status comments.
- **Notes:** The live automation configuration is updated; #542 remains open until unchanged-blocker and changed-transition behavior are observed through scheduled runs.
