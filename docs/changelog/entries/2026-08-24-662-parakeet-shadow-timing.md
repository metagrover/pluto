### Restore Parakeet shadow transcription for real recorder timing

- **Issue:** [#662](https://github.com/metagrover/pluto/issues/662)
- **PR:** Pending.
- **Changed:** Background mic and System Parakeet shadow windows now seal on durable receipt boundaries after reaching their 30-second target.
- **Why:** Browser recorder intervals drift, so the former exact 30.000-second boundary rejected ordinary recordings before submitting any shadow audio.
- **Replaced:** Exact 30.000-second receipt endings as a prerequisite for shadow-window submission.
- **Notes:** Receipt-aligned windows may overshoot the target by one capture interval; the shorter final tail still flushes once at stop.
- **Safety:** Receipt identity, sequence, and time continuity still fail closed; live MLX text and canonical Parakeet finalization are unchanged.
