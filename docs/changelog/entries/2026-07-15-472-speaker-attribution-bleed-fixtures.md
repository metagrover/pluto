### Cover speaker-attribution bleed regressions with committed fixtures

- **Issue:** `#472`
- **PR:** `Pending.`
- **Changed:** Expanded Pluto's committed synthetic speaker-attribution regression suite to cover all-remote pass-through, a single short genuine local turn, a longer local anchor between pass-through spans, and overlap after remote bleed.
- **Why:** `#460` remains the highest-priority open recording attribution bug, and current `master` needed explicit committed fixtures that prove remote mic bleed cannot silently return as false `Me` transcript ownership while preserving real local speech.
- **Replaced:** Relying on a narrower synthetic suite that did not name or lock the key bleed/pass-through failure shapes called out by the speaker-attribution bug.
- **Notes:** This slice hardens the regression boundary on current `master` without depending on the separate unmerged recording-quality benchmark harness.
