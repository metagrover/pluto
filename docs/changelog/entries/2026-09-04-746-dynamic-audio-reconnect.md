### Dynamic audio device reconnect listeners for crash-safe capture

- **Issue:** [#746](https://github.com/metagrover/pluto/issues/746)
- **PR:** [#751](https://github.com/metagrover/pluto/pull/751)
- **Changed:** Added dynamic audio device reconnection listeners across the renderer (`devicechange`) and native audio engine (`CoreAudio` property listeners for default input, output, and device changes). The audio capture pipeline automatically reconfigures without dropping active sessions when devices disconnect or reconnect (such as Bluetooth headphones or USB microphones). Added streaming 16kHz fractional audio resampling with carryover buffers at the mic capture boundary and native frame-receipt watchdog verification.
- **Why:** Bluetooth audio transitions or USB hardware disconnects previously caused audio capture deadlocks, audio context sample rate mismatches against Parakeet EOU timestamp contracts, or abrupt recording failures.
- **Replaced:** Static audio device binding acquired only once at recording start.
- **Preserved:** Durable recording journal integrity, EOU streaming transcription, zero raw audio or sensitive hardware identifier logging, and existing capture finalization workflows.
- **Notes:** Capturing UI displays a calm, non-blocking `Reconfiguring audio devices...` indicator during hardware switches rather than disruptive alerts.
