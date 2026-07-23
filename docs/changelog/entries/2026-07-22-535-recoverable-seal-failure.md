### Preserve meetings when capture-journal sealing fails

- **Issue:** [#535](https://github.com/metagrover/pluto/issues/535)
- **PR:** [#544](https://github.com/metagrover/pluto/pull/544)
- **Changed:** Recording stop now seals the capture journal before derived finalization and preserves a visible `recovery_required` meeting when sealing fails.
- **Why:** A meeting must not disappear, but unsealed evidence must not look normally finalized or feed downstream intelligence.
- **Replaced:** Warning-and-continue finalization after a capture-journal seal failure.
- **Notes:** The recovery-required state exposes no recording content, identities, credentials, or local paths. Automatic recovery and retry controls remain follow-up work.
