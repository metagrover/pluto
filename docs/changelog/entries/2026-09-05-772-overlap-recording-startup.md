### Start meetings without serial System-audio setup

- **Issue:** [#772](https://github.com/metagrover/pluto/issues/772)
- **PR:** Direct to `master` at the user's request.
- **Changed:** Pluto starts the native System-audio tap as soon as the durable capture journal owns the meeting, overlapping its PCM readiness proof with transcription and microphone setup.
- **Why:** Waiting to launch System capture until every independent startup step had finished added avoidable delay before durable microphone recording could begin.
- **Replaced:** Serially launching and awaiting System-audio PCM only after transcription and microphone setup.
- **Trust boundary:** Pluto still subscribes before launching AudioCap, requires valid System PCM or persists a source failure, and does not show `Recording` until the microphone `MediaRecorder` is active.
- **Verification:** Source-order regression coverage proves the overlap and synchronized publication boundaries; focused recording tests, TypeScript, lint, and changelog validation run before delivery.
- **Notes:** Parakeet cold starts remain intentionally fail-closed and are outside this focused System-audio latency repair.
