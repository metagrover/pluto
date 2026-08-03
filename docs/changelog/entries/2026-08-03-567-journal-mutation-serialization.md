### Serialize live capture-journal mutations before sealing
- **Issue:** [#567](https://github.com/metagrover/pluto/issues/567)
- **PR:** [#568](https://github.com/metagrover/pluto/pull/568)
- **Changed:** Live audio, activity evidence, transcript checkpoints, acceptance frames, and the stop-to-seal transition now share one renderer mutation coordinator that keeps each revision read and write atomic and drains accepted work before sealing.
- **Why:** Independent renderer queues could advance the same journal revision between another task's read and write, reject the final audio append, and show recovery-required after a normal meeting stop.
- **Replaced:** Coordinating only audio and activity tasks while transcript persistence independently mutated the same revisioned manifest.
- **Notes:** Genuine write, checksum, generation, and invariant failures remain fail-closed. Diagnostics, tests, and changelog evidence remain content-free.
