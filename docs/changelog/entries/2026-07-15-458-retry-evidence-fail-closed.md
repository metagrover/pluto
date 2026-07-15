### Fail closed on missing or corrupt deterministic retry evidence

- **Issue:** `#458`
- **PR:** `(pending)`
- **Changed:** Transcript-validation retries now distinguish valid stored capture evidence, legacy provisional fallback, missing expected deterministic evidence, and corrupt stored evidence. When a meeting claims capture-backed retry evidence but the payload is absent or malformed, Pluto records an explicit retry-evidence reason, keeps the retry in `needs_attention`, and avoids silently treating transcript-derived windows as equivalent deterministic proof.
- **Why:** The `#454` persistence slice closed the main retry-evidence gap, but `#445` still required missing or corrupt evidence to fail closed instead of degrading invisibly into a legacy-style retry.
- **Replaced:** Silently falling back to provisional transcript activity windows even when a capture-backed retry should have had durable evidence.
- **Notes:** Legacy meetings without stored capture evidence still retry with an explicit `legacy_provisional_segments` label. This does not change transcript thresholds or model policy.
