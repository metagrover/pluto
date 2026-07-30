### Measure live transcript responsiveness

- **Issue:** [#549](https://github.com/metagrover/pluto/issues/549)
- **PR:** [#550](https://github.com/metagrover/pluto/pull/550)
- **Changed:** Pluto now records content-free first-live-text and accepted-update cadence evidence and gates the same semantics with deterministic benchmark traces.
- **Why:** Whole-case timers could not show whether live transcription reached the user promptly or updated regularly.
- **Replaced:** No previous live responsiveness evidence contract.
- **Notes:** Runtime values are observational; this change adds no threshold, UI behavior, private fixture, or external telemetry.
