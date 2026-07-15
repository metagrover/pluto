### Persist retry activity evidence for transcript validation

- **Issue:** `#454`
- **PR:** `(pending)`
- **Changed:** Recording finalization now stores a versioned, content-free activity-evidence snapshot with transcript integrity results, and transcript-validation retries reuse that snapshot instead of reconstructing speaker activity from sparse provisional transcript segments. Legacy meetings without stored evidence still retry, but the saved integrity payload now labels that provisional-segment fallback explicitly.
- **Why:** Retry validation could previously erase missing-speech evidence whenever provisional transcript segments were incomplete, which broke the deterministic retry contract under `#445`.
- **Replaced:** Rebuilding retry activity windows from provisional transcript text alone.
- **Notes:** This stays scoped to the retry evidence contract. It does not yet persist capture-journal manifests or broader crash-recovery state.
