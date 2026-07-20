### Map local speech from acoustic evidence

- **Issue:** `#515`
- **PR:** `#521`
- **Changed:** Pluto now has a deterministic acoustic-evidence contract that classifies aligned mic/system energy, maps at most one diarization cluster to `Me`, keeps pass-through and all-remote speech as `Them`, and emits bounded short-local-turn recovery windows.
- **Why:** Microphone presence is not speaker identity when loudspeaker playback bleeds into the mic; local identity needs evidence that excludes system-correlated audio.
- **Replaced:** Final-path cluster mapping that depended on channel-labeled transcript segments and live UI activity labels.
- **Notes:** The mapper is text-independent and content-free. Its synthetic regression includes the measured 0.541-second interruption and preserves the overlapping remote turn.
