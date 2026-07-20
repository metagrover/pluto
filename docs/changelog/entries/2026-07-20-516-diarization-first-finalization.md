### Finalize recordings with acoustic speaker attribution

- **Issue:** `#516`
- **PR:** `#522`
- **Changed:** Completed recordings now derive aligned mic/system energy, map local identity through the credential-free diarizer and acoustic evidence, persist the attributed transcript plus trust metadata before downstream intelligence, and expose verified local-model preparation in setup and Settings.
- **Why:** Diarization boundaries alone cannot identify `Me`, and downstream notes must never run against attribution that has not been validated and saved.
- **Replaced:** Channel-labeled transcript references, live UI activity labels, ineffective local-diarizer retries through unrelated ASR settings, and analysis generation before transcript persistence.
- **Notes:** Pipeline version `3.0.0` stores content-free engine checksums, near-end evidence state, injected-local-window count, and false/missed-`Me` evidence durations. Missing evidence remains explicit instead of promoting microphone speech.
