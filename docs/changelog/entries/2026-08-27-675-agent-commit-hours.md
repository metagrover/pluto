### Define agent commit working hours

- **Issue:** `#675`
- **PR:** `(pending)`
- **Changed:** Repository instructions now allow normal agent commits Monday through Friday from 09:00 through 17:00 in `Europe/Berlin` and require an explicit user request for commits outside that window. Editing, testing, and staging remain available at all times.
- **Why:** Development can continue asynchronously without letting off-hours agent work change Git history unless the user deliberately requests it.
- **Replaced:** An implicit commit policy that did not define working hours, timezone, or the boundary between code edits and Git history.
- **Notes:** The policy governs agent behavior only; it does not restrict maintainers or automated CI release jobs.
