### Proof-backed transcript trust state

- **Issue:** [#556](https://github.com/metagrover/pluto/issues/556)
- **PR:** Pending
- **Changed:** Pluto now persists one versioned transcript-trust envelope across recovery, validation, retry, Meeting View, and downstream processing; derives user copy and available actions from explicit causes and capabilities; and requires durable validation proof before generating meeting intelligence.
- **Why:** Recovered recordings and other actionable validation states could previously show the speech-loss warning even when Pluto had no evidence that captured speech was missing.
- **Replaced:** Independent status heuristics, recovery-as-loss copy, implicit validated defaults, and downstream generation gates based only on transcript presence.
- **Notes:** Existing recordings remain readable through a legacy compatibility path, but legacy state cannot authorize new derived intelligence. Benchmark and diagnostic artifacts remain content-free and do not include transcript text, identities, audio, credentials, or local paths.
