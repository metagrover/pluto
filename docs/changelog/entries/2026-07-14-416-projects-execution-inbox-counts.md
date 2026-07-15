### Include inbox tasks in Execution brief counts
- **Issue:** [#416](https://github.com/metagrover/pluto/issues/416)
- **PR:** Pending.
- **Changed:** The Projects Execution brief now counts active inbox tasks separately from linked project work, so mixed states read like `3 open across 1 project and 2 inbox items` and inbox-only states avoid misleading `0 projects` framing.
- **Why:** `#61` is supposed to make Pluto's follow-up lifecycle trustworthy across surfaces. After the recent completed-work cleanups, current `master` could still summarize active inbox work as if it lived across zero projects, which flattened a real triage state into misleading project language.
- **Replaced:** Execution header copy that ignored active inbox tasks when summarizing live work.
- **Notes:** This stays scoped to execution-summary copy in `ProjectsExecutionTab`; it does not change task grouping, ranking, or completion behavior.
