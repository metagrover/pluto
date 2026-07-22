### Bound transcript-validation retries

- **Issue:** [#539](https://github.com/metagrover/pluto/issues/539)
- **PR:** Pending
- **Changed:** Made transcript-validation retry an atomic, durable lease with preserved integrity evidence, a duration-scaled deadline, conditional failure recovery, startup expiry recovery, real transcription cancellation, and honest stage copy.
- **Why:** An hour-long retry could overwrite prior evidence, consume sidecar resources indefinitely, and leave a meeting stuck in `validating` across errors or restart.
- **Replaced:** An unconditional run-ID-only save followed by unbounded concurrent transcription and downstream generation inside the validation transaction.
- **Notes:** The change contains no private audio, transcript, identity, credential, or local-path evidence. Per-source durable caching and restart resumption remain tracked by #442.
