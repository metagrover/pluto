### Design durable capture activity evidence

- **Issue:** [#445](https://github.com/metagrover/pluto/issues/445)
- **PR:** Pending
- **Changed:** Defined a versioned capture-journal contract that incrementally persists one canonical content-free activity envelope and reuses its sealed payload and digest across validation, recovery, persistence, and retry.
- **Why:** Crash recovery currently preserves acknowledged audio but can lose the original activity evidence and fall back to a weaker reconstruction.
- **Replaced:** Building retry evidence only after final transcription from renderer memory.
- **Notes:** The design keeps v1 journals readable, fails closed for declared v2 evidence corruption, and introduces no retention, privacy, threshold, model, or UI policy change.
