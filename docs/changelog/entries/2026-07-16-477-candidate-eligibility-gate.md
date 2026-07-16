### Gate local attribution candidates on credential-free distribution metadata

- **Issue:** `#477`
- **PR:** `Pending.`
- **Changed:** Pluto's committed recording-quality benchmark now supports `candidate_eligibility` cases that evaluate local attribution candidates against credential-free distribution metadata, checksum pinning, and platform support. The benchmark report and docs now surface explicit eligibility verdicts and rejection reasons without private content.
- **Why:** `#476` and `#465` need a hard benchmark gate that rejects production-ineligible models before any private bake-off or runtime integration work begins.
- **Replaced:** Ad hoc manual review of candidate distribution constraints before benchmark results were considered.
- **Notes:** This slice stays at the benchmark-contract layer on current `master`. It does not download models, add user credential flows, or integrate any selected engine into recording finalization.
