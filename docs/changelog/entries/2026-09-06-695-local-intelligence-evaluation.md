### Reproducible 16 GB local-intelligence evaluation

- **Issue:** [#695](https://github.com/metagrover/pluto/issues/695)
- **Added:** An opt-in, production-path local-model replay harness with pinned model digests, request-wire assertions, source-backed synthetic gold cases, physical-attempt accounting, and owner-only raw artifacts.
- **Measured:** Five installed Ollama models were screened on an M1 Pro with 16 GiB memory across quick chat, meeting notes, cross-meeting synthesis, and dreaming safety cases.
- **Decision:** No model or integrated configuration passed the frozen promotion protocol. Production defaults remain unchanged; Phi advances only as a notes candidate for a larger human-reviewed follow-up.
- **Trust:** Replays do not write production tables, publish notes, accept proposals, or expose private meeting content in the committed aggregate report.
