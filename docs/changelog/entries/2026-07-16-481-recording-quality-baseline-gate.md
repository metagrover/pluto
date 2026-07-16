### Gate recording-quality regressions against recorded `master` baselines

- **Issue:** `#481`
- **PR:** `Pending.`
- **Changed:** Recording-quality benchmark cases can now declare tracked metrics with explicit tolerances plus `stable` versus `hardware_dependent` drift policies, and `pnpm run benchmark:recording-quality` compares those metrics against the recorded `master` baseline before writing the report.
- **Why:** `#481` exists to turn Pluto's committed recording benchmark from a point-in-time fixture check into a baseline-aware regression gate, so recording-trust changes can catch real quality drift without pretending every machine-sensitive metric should fail the run.
- **Replaced:** A benchmark CLI that only reported current pass counts and artifact paths even though `#443` already required explicit baseline tolerances and human-readable regression summaries.
- **Notes:** Stable regressions now fail the command, hardware-dependent drift stays visible in a separate summary section, and missing baseline metrics are surfaced without expanding the benchmark beyond the committed synthetic corpus.
