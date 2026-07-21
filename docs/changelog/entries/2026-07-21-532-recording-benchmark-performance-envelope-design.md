### Record honest recording-benchmark performance evidence

- **Issue:** [#532](https://github.com/metagrover/pluto/issues/532)
- **PR:** [#533](https://github.com/metagrover/pluto/pull/533), [#534](https://github.com/metagrover/pluto/pull/534)
- **Changed:** Added a schema-version-3 measurement envelope for elapsed time, process CPU, sampled peak RSS, and deterministic case-produced artifact bytes to every committed recording-quality benchmark result, with concise terminal evidence and named baseline comparison support.
- **Why:** Quality decisions need visible cost evidence, but heterogeneous developer and CI machines cannot support trustworthy raw timing or resource regression gates by default.
- **Replaced:** Recording-quality reports that carried environment labels and functional metrics without explicit performance/resource measurements, availability semantics, or deterministic artifact-size gates.
- **Notes:** Deterministic artifact size may gate against a reviewed baseline. Timing, CPU, and memory remain hardware-dependent and report-only until a later calibrated performance tier is designed from evidence.
