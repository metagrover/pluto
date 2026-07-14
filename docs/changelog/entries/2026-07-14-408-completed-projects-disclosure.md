### Tuck completed-only projects behind an Execution brief disclosure
- **Issue:** [#408](https://github.com/metagrover/pluto/issues/408)
- **PR:** Pending.
- **Changed:** The Projects execution brief now keeps projects with active or overdue tasks in the main queue and moves completed-only projects behind a separate disclosure. Finished work stays reachable for review or reopening without competing with live commitments in the first viewport.
- **Why:** `#407` tucked completed tasks inside each project card, but current `master` still listed completed-only projects in the primary execution queue. That contradicted the new “completed work is tucked away” framing and made finished projects read like active work.
- **Replaced:** Completed-only project cards appearing inline with active execution work.
- **Notes:** This stays scoped to `ProjectsExecutionTab`. Task lifecycle toggles, inbox handling, and per-project completed-task disclosure behavior stay on their existing paths.
