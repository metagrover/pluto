### Design diarization-first final speaker attribution

- **Issue:** `#460`
- **PR:** Pending.
- **Changed:** Defined the production boundary for credential-free mixed-audio diarization, microphone-exclusive near-end evidence, cluster mapping, retry, trust metadata, and atomic downstream gating.
- **Why:** Pluto needs to recover genuine short local turns without letting loudspeaker pass-through in the microphone channel become false `Me` attribution.
- **Replaced:** An implementation direction that still depended on token-gated WhisperX diarization and channel-labeled reference segments.
- **Notes:** The design contains no private audio, transcript content, meeting identity, or filesystem path; consented acceptance evidence remains local and gitignored.
