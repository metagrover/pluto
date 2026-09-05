### Remove noisy remote speaker status banner from transcript view

- **Issue:** [#444](https://github.com/metagrover/pluto/issues/444)
- **PR:** Pending.
- **Changed:** Removed the persistent informational banner ("Transcript ready · Remote speakers not separated") from the meeting transcript view.
- **Why:** The transcript view should remain calm, quiet, and focused on reading; diagnostic statements about unseparated remote speakers cluttered the transcript surface without providing an actionable user task.
- **Replaced:** Standalone informational banner displayed above transcript turns when remote speaker clusters were unresolved.
- **Notes:** Canonical transcript text and turns remain unchanged. Speaker identification remains directly accessible from the meeting header and turn tags.
