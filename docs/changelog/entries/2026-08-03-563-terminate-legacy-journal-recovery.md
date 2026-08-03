### Terminate legacy interrupted-journal recovery
- **Issue:** [#563](https://github.com/metagrover/pluto/issues/563)
- **PR:** Pending.
- **Changed:** Recovery now transcribes the journal-aligned trailing duration of overlong persisted repair audio, discards malformed optional word timings without losing valid segments, and seals resolved v3 journals with explicit capture gaps into recoverable `needs_attention` meetings.
- **Why:** Historical buffered pre-roll could make valid Whisper timestamps exceed a short tail interval, while explicit missing-source failures kept otherwise salvageable journals retrying forever.
- **Replaced:** Transcribing an overlong repair artifact unchanged and treating an acknowledged capture gap as unresolved transcript repair work.
- **Notes:** Original repair audio stays untouched, normal-duration artifacts avoid conversion, unresolved transcript requests still block sealing, and canonical validation plus downstream intelligence remain fail-closed.
