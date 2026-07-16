### Gate recording-quality regressions against `master` baselines

- **Issue:** `#481`
- **PR:** `#487`
- **Changed:** `pnpm run benchmark:recording-quality` now reads per-case tracked metrics from the committed manifest, compares them against the current `master` baseline with tolerance-aware stable versus hardware-dependent handling, and prints a concise baseline-comparison summary alongside the fixture pass counts.
- **Why:** `#443` needed the committed benchmark corpus to fail future recording-trust changes with evidence-backed baseline drift instead of only raw case expectations, so Pluto can distinguish real regressions from acceptable machine-specific timing changes.
- **Replaced:** A benchmark contract that only checked point-in-time fixture expectations and could not prove whether output drift from the committed `master` baseline was intentional.
- **Notes:** This slice keeps retry-validation integrity checks in their existing fixture expectations, refreshes the committed `current-master` report to the new comparison-capable format, and limits the new baseline gate to deterministic numeric metrics plus the hardware-dependent finalization timing metric.
