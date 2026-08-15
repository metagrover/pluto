### Restore the transcript-integrity release baseline

- **Issue:** [#622](https://github.com/metagrover/pluto/issues/622)
- **PR:** [#623](https://github.com/metagrover/pluto/pull/623)
- **Changed:** Generic meeting saves preserve canonical transcript evidence, remote integrity validation requires time-aligned coverage, content-bearing query and title logs are redacted, retained microphone audio nodes are released, and the merged TypeScript baseline builds again.
- **Why:** Incomplete rolling-validation scaffolding was not connected to recording or finalization, while lossy save-time cleanup, unsafe coverage substitution, and accumulated type errors could corrupt evidence or block releases.
- **Replaced:** Unconditional transcript cleanup, total-word-count coverage substitution, dead rolling reconciliation and auto-learning runtime stubs, and documentation that described those stubs as implemented behavior.
- **Notes:** #616 remains the source of truth for an end-to-end background validation pipeline with stable segment identity, provenance, scheduling, persistence, UI state, and final-analysis reuse. Verification uses synthetic and content-free evidence only.
