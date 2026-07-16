### Gate recording-quality regressions against the committed `master` baseline

- **Issue:** `#481`
- **PR:** Pending.
- **Changed:** The committed recording-quality benchmark manifest now declares tolerance-tracked metrics per case, benchmark reports carry those tracked metrics through to baseline comparisons, and `pnpm run benchmark:recording-quality` prints a concise comparison summary instead of only raw pass counts.
- **Why:** `#443` needs Pluto to judge recording-trust changes against an explicit `master` baseline, not just point-in-time fixture expectations. This adds the drift gate that turns the committed corpus into a real regression guard.
- **Replaced:** Treating the committed benchmark as a pass/fail fixture runner with no tolerance-aware comparison against the recorded baseline.
- **Notes:** Stable tracked metrics now fail the command when they drift outside tolerance, while hardware-dependent metrics stay visible in a separate summary section without failing the run on their own.
