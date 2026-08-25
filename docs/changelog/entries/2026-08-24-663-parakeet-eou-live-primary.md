### Use English Parakeet for live and final transcription

- **Issue:** [#663](https://github.com/metagrover/pluto/issues/663)
- **PR:** Pending.
- **Changed:** Live microphone and System text uses independent local Parakeet EOU sessions with 320 ms causal audio advances. Pluto verifies the pinned English live and final models at launch, automatically prepares missing models behind a visible loading state, and offers an explicit retry state. Development startup rebuilds the native Parakeet runtime before Electron launches.
- **Why:** True streaming reduces preview delay, while launch verification prevents the workspace from appearing ready with missing models or a stale native runtime.
- **Replaced:** Five-second MLX Whisper live preview, MLX recording-readiness checks, and model refresh attempts against unavailable latest-release native binary URLs.
- **Notes:** Sealed Parakeet finalization remains canonical. AudioCap downmixes interleaved System stereo using the stream format, recording listeners unsubscribe exactly once between sessions, and final vocabulary bias is limited to explicit meeting participants.
- **Safety:** MLX source remains temporarily packaged for separately reviewed removal, but recording transcription cannot invoke it. Live EOU text is provisional and the sealed Parakeet final remains the persisted source of truth.
