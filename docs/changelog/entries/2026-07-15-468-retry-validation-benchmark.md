### Cover retry-validation evidence regressions in the recording benchmark

- **Issue:** `#468`
- **PR:** `#469`
- **Changed:** Pluto's committed recording-quality benchmark now supports synthetic retry-validation fixtures and includes fail-closed regression cases for missing and corrupt deterministic retry evidence.
- **Why:** The `#447` benchmark foundation covered initial validation and finalization, but the deterministic retry-evidence fixes from `#454` and `#458` were still protected only by focused unit tests instead of the committed corpus that guards `#443`.
- **Replaced:** Treating retry-validation evidence regressions as ad hoc unit-test-only coverage outside the recording-quality benchmark command.
- **Notes:** This stays scoped to retry-validation benchmark coverage. It does not yet cover crash-journal recovery or transcript model policy selection.
