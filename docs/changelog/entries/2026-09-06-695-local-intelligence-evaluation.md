### Reproducible 16 GB local-intelligence evaluation

- **Issue:** [#695](https://github.com/metagrover/pluto/issues/695)
- **PR:** [#780](https://github.com/metagrover/pluto/pull/780)
- **Changed:** Added an opt-in, production-path local-model replay harness with pinned model digests, request-wire assertions, source-backed synthetic gold cases, physical-attempt accounting, and owner-only raw artifacts. Screened five installed Ollama models on an M1 Pro with 16 GiB memory across quick chat, meeting notes, cross-meeting synthesis, and dreaming safety cases.
- **Why:** Establish reproducible local intelligence evaluation benchmarks on 16 GB Apple Silicon without writing to production tables or publishing synthetic proposals.
- **Replaced:** Ad-hoc model comparisons and unverified performance assertions.
- **Notes:** No model or integrated configuration passed the frozen promotion protocol. Production defaults remain unchanged; Phi advances only as a notes candidate for a larger human-reviewed follow-up. Replays do not write production tables, publish notes, accept proposals, or expose private meeting content in the committed aggregate report.
