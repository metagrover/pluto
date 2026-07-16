### Gate interrupted capture recovery in the committed benchmark

- **Issue:** `#493`
- **PR:** `#494`
- **Changed:** The content-safe recording-quality corpus now materializes synthetic mic and system capture chunks, runs Pluto's real interrupted-journal recovery boundary, and tracks recovered chunk coverage against the committed `master` baseline.
- **Why:** Crash/restart recovery was protected by focused unit tests but absent from the shared benchmark required by `#443`, so recovery regressions could escape the quality gate used by recording changes.
- **Replaced:** Benchmark coverage limited to transcript validation, retry evidence, and finalization behavior.
- **Notes:** The case proves both source paths remain recoverable while a same-size checksum-corrupt mic tail is excluded and reported explicitly; temporary artifacts are removed after every run and no private audio or paths enter the corpus.
