### Design honest recording-benchmark performance evidence

- **Issue:** [#532](https://github.com/metagrover/pluto/issues/532)
- **PR:** Pending.
- **Changed:** Defined a versioned measurement envelope for elapsed time, process CPU, sampled peak RSS, and deterministic case-produced artifact bytes in Pluto's committed recording-quality benchmark.
- **Why:** Quality decisions need visible cost evidence, but heterogeneous developer and CI machines cannot support trustworthy raw timing or resource regression gates by default.
- **Replaced:** Recording-quality reports that carry environment labels and functional metrics without explicit performance/resource measurements or availability semantics.
- **Notes:** Deterministic artifact size may gate against a reviewed baseline. Timing, CPU, and memory remain hardware-dependent and report-only until a later calibrated performance tier is designed from evidence.
