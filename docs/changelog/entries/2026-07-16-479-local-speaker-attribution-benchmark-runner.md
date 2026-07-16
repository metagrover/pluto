### Add a local speaker-attribution benchmark runner

- **Issue:** `#479`
- **PR:** `(pending)`
- **Changed:** Pluto now ships a local speaker-attribution benchmark runner with a versioned manifest/report contract, deterministic Me/Them attribution metrics, a JSONL-based candidate adapter boundary, committed synthetic fixtures, and a CLI that writes JSON and Markdown benchmark reports.
- **Why:** `#465` needed the core benchmark engine before the private-manifest (`#474`) and credential-gate (`#477`) slices could plug into a real local bake-off path. This establishes the committed synthetic runner so future attribution work can compare candidate engines without rebuilding the execution and scoring pipeline.
- **Replaced:** Ad hoc or branch-local local-attribution experiments that were not available on current `master`.
- **Notes:** This slice stays on committed synthetic fixtures only. It does not add private-corpus path handling, credential-free production eligibility, or finalization integration.
