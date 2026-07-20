### Keep project-priority verification independent of wall time

- **Issue:** `#518`
- **PR:** `#519`
- **Changed:** The slipping-project ordering regression now uses stable future dates for routine work instead of dates that became overdue as the calendar advanced.
- **Why:** Current `master` began failing its full test suite on July 20, 2026 even though the production ordering behavior had not regressed.
- **Replaced:** Wall-clock-sensitive test fixtures tied to July 2026.
- **Notes:** Production Projects behavior is unchanged.
