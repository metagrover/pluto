### Get new installs ready for a trusted first recording

- **Issue:** [#615](https://github.com/metagrover/pluto/issues/615)
- **PR:** Not opened yet.
- **Changed:** Pluto now guides first-run users through one recording-readiness screen that prepares local transcription, checks microphone and system-audio permissions, and exposes concise retry actions.
- **Why:** The previous flow checked development-time Python, explained speaker identification separately, and asked for an analysis provider before proving that the installed app could record and transcribe a meeting.
- **Replaced:** Four setup screens, the invisible first-run Parakeet download, the unconditional startup microphone prompt, and the incomplete packaged-runtime resource filter.
- **Notes:** Native executables ship in the signed app bundle; large Parakeet and speaker assets remain in Pluto-managed user data and are downloaded once, verified, and reused. Analysis-provider selection remains available in Settings and does not block recording readiness.
