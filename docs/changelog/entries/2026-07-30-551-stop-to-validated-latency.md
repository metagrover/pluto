### Measure durable recording finalization latency

- **Issue:** [#551](https://github.com/metagrover/pluto/issues/551)
- **PR:** [#552](https://github.com/metagrover/pluto/pull/552)
- **Changed:** Pluto now records a strict content-free stop-to-durable-validated latency summary, preserves it through retry, guards metric and derived writes against newer transcript generations, and gates the contract with deterministic benchmark traces.
- **Why:** Whole-case and live-responsiveness measurements could not expose the user-visible wait between an accepted stop and the first crash-safe validated transcript.
- **Replaced:** The later unconditional full meeting save with transcript-generation-guarded metric and derived-field updates.
- **Notes:** Runtime values are observational and local; no threshold, UI, telemetry, private fixture, model policy, retention rule, or transcription behavior changed.
