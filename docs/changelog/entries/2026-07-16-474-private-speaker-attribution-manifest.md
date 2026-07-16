### Validate and redact private speaker-attribution manifests

- **Issue:** `#474`
- **PR:** `#475`
- **Changed:** Pluto now validates a gitignored private speaker-attribution benchmark manifest with absolute local audio/transcript paths, rejects duplicate or malformed cases up front, and emits a privacy-safe summary with hashed case identifiers instead of raw paths or transcript text.
- **Why:** `#465` needs a safe bridge from the committed synthetic corpus to consented local benchmark cases before any engine bake-off can run. This slice establishes the manifest contract and redaction boundary without committing private artifacts.
- **Replaced:** Ad hoc local-only benchmark wiring with no typed manifest validation or guaranteed report redaction.
- **Notes:** This stays scoped to manifest validation and privacy-safe summaries. It does not yet execute candidate attribution engines or record bake-off decisions.
