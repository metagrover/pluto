### Expose duplicate model work in trusted meeting notes

- **Issue:** [#739](https://github.com/metagrover/pluto/issues/739)
- **PR:** [#740](https://github.com/metagrover/pluto/pull/740)
- **Changed:** A deterministic repository report now separates capture sealing, canonical transcript finalization, trusted-note generation, and post-publication enrichment while accounting for note-stage model calls, tokens, repeated source consumption, repairs, identical recovery outputs, and a benchmark-only deterministic recovery replay.
- **Why:** A single stop-to-notes total can misattribute capture or transcription delay to notes generation, while aggregate retry counts hide expensive repairs that reproduce the rejected response unchanged.
- **Replaced:** Ad hoc inspection of captured note attempts without an explicit privacy-safe timing and recovery ledger.
- **Notes:** The initial committed synthetic editor captures measure only canonical-to-trusted-notes work. Other boundaries remain explicitly unavailable. The replay mechanically recovered all four duplicate writer-repair candidates through the existing strict parser and source guardrails, representing 177,875 ms of captured repair-model time; it correctly refused the one duplicate audit repair, representing 31,747 ms. Structural recovery and guardrail passage do not establish semantic correctness or authorize production parser changes.
- **Safety:** The command makes no model or database calls, does not change production behavior, and rejects reports containing transcript, prompt, response, evidence, participant, private-path, or sentinel content.
