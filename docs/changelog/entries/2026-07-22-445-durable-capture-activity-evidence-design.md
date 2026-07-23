### Persist durable capture activity evidence

- **Issue:** [#445](https://github.com/metagrover/pluto/issues/445)
- **PR:** Pending
- **Changed:** Version 2 capture journals incrementally persist canonical content-free activity evidence, prevent sealing after any evidence write failure, and reuse the verified sealed digest across initial validation, recovery, and retry.
- **Why:** Crash recovery currently preserves acknowledged audio but can lose the original activity evidence and fall back to a weaker reconstruction.
- **Replaced:** Building retry evidence only after final transcription from renderer memory.
- **Notes:** Version 1 journals remain readable; version 2 evidence corruption fails closed, and no retention, privacy, threshold, model, or UI policy changes were introduced.
