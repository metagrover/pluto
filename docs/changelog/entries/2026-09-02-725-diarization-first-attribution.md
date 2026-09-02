### Verify speakers acoustically before publishing a final transcript

- **Issue:** [#725](https://github.com/metagrover/pluto/issues/725)
- **PR:** Pending review.
- **Changed:** Pluto's local Parakeet finalization now runs a pinned, integrity-checked offline diarization model against the saved mixed recording, combines anonymous speaker turns with microphone and system-channel energy, and commits `Me`/`Them` labels only when the acoustic acceptance gate passes.
- **Why:** Channel origin alone cannot prove that every utterance belongs to the expected speaker, which allowed a sentence spoken by the meeting owner to be attributed to someone else.
- **Replaced:** Treating microphone and system channels as sufficient final speaker identity, and allowing channel-fallback speaker maps to unlock downstream meeting intelligence.
- **Repair:** Meetings previously finalized with channel-fallback attribution remain visible and unchanged until the user chooses Retry transcription. That retry uses the saved mic, system, and mixed recordings, compare-and-save guards against concurrent transcript or source changes, and preserves the prior canonical transcript if attribution cannot be verified.
- **Downstream:** Automatic notes, identity binding, and other meeting intelligence no longer treat an unverified Parakeet speaker map as final. Accepted offline attribution retains its provenance through commitment-owner resolution.
- **Trust boundary:** Model artifacts are pinned and verified before evidence is accepted. Runtime IPC returns timestamps, anonymous cluster identifiers, energy values, provenance, and timings only—never transcript text. Rejected or incomplete acoustic evidence fails closed with an actionable local retry state.
- **Evidence:** Native protocol/model/energy tests, Electron client and worker tests, database compare-and-save tests, historical-repair tests, and UI presentation coverage exercise the new boundary without using private meeting content.
- **Notes:** The retry is local and user initiated. Existing notes remain visible while the canonical transcript is preserved until a verified replacement can commit atomically.
