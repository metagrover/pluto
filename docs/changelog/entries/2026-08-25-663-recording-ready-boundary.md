### Start recording only when capture is ready

- **Issue:** [#663](https://github.com/metagrover/pluto/issues/663)
- **PR:** Pending.
- **Changed:** Pluto keeps the meeting in its explicit starting state until live microphone PCM and durable MediaRecorder capture are active. Direct Parakeet EOU hypotheses remain the only live transcript path, while sealed post-meeting Parakeet finalization remains canonical.
- **Why:** Publishing the recording state before microphone acquisition and recorder startup invited users to speak during an interval that was not guaranteed to be captured, making intermittent missing opening words possible.
- **Evidence:** The latest persisted meeting retained microphone audio from time zero and opening words at 0.4 seconds; its longer first-text metric included startup, while measured speech-to-text latency after detection was 1.12 seconds. A source-order regression test now enforces the capture-ready boundary.
