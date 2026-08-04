### Stabilize recovered transcripts and generated knowledge boundaries
- **Issue:** [#569](https://github.com/metagrover/pluto/issues/569), [#570](https://github.com/metagrover/pluto/issues/570)
- **PR:** [#571](https://github.com/metagrover/pluto/pull/571)
- **Changed:** Recovery now normalizes local transcription segments before capture-journal persistence, and knowledge synthesis validates generated V2 structures and filters malformed collection members before repair or merge.
- **Why:** Out-of-range recovered timestamps could violate journal invariants, while malformed generated knowledge members could crash synthesis instead of producing the deterministic fallback document.
- **Replaced:** Trusting recovery-service segment boundaries and shallow knowledge-envelope validation at persistence and merge boundaries.
- **Notes:** Recovery drops unsupported out-of-window evidence, knowledge remains fail-safe, and verification artifacts stay content-free.
