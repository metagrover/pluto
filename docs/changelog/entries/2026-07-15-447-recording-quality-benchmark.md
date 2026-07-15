### Add a committed recording-quality benchmark corpus and report schema

- **Issue:** `#447`
- **PR:** `(pending)`
- **Changed:** Pluto now ships a committed, content-safe recording-quality benchmark command that exercises current transcript-validation and recording-finalization helpers against synthetic regression fixtures for `#25`, `#75`, `#428`, and `#434`. The command writes a versioned JSON report, prints a concise pass/fail summary, and documents how to extend the corpus without private meeting fixtures.
- **Why:** `#443` needs a benchmark foundation that can run locally and in CI without private DB state or local meeting audio. This slice establishes the committed corpus, report contract, and baseline artifact so future recording-trust work can add cases instead of rebuilding benchmark plumbing.
- **Replaced:** A local-only benchmark path that depended on replaying private fixtures outside the repo.
- **Notes:** This stays scoped to the offline committed corpus and report layer. It does not yet benchmark live capture journaling, model-policy selection, or recording UI behavior.
