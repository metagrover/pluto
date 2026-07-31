### Reuse accepted live transcription during meeting finalization
- **Issue:** [#442](https://github.com/metagrover/pluto/issues/442)
- **PR:** Pending.
- **Changed:** New recordings durably checkpoint accepted microphone and system transcript chunks beside checksummed repair audio. Clean stop and interrupted recovery verify and reuse those checkpoints, repair only unresolved captured chunks, and atomically claim standard meeting analysis after validation.
- **Why:** Pluto could show a healthy transcript during recording and then discard it, repeat complete-recording transcription, and leave the preserved meeting waiting for validation.
- **Replaced:** Treating live transcription as renderer-only state and treating full-session retranscription as the default validation path.
- **Notes:** Legacy v1/v2 journals keep their compatibility recovery path. Transcript text remains confined to local checkpoint sidecars and canonical meeting storage; committed evidence and diagnostics remain content-free.
