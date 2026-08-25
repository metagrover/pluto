# English Parakeet EOU live transcription

## Changed

- Live microphone and System text now comes from independent local Parakeet EOU sessions with 320 ms causal audio advances.
- Recording readiness requires the verified English EOU model; Pluto never switches live transcription to MLX.
- AudioCap now downmixes interleaved System stereo using the stream format, and recording listeners unsubscribe exactly once between sessions.
- Sealed capture journals materialize the System WAV used by canonical Parakeet finalization.
- Final vocabulary bias is limited to explicit meeting participants, so unrelated known-person names cannot rewrite ordinary English speech.

## Why

- True streaming reduces preview delay and one explicit engine makes failures observable instead of hiding them behind fallback behavior.

## Replaced

- Replaces five-second MLX Whisper live preview and MLX recording-readiness checks. Sealed Parakeet finalization remains canonical.

## Notes

- MLX source remains temporarily packaged for separately reviewed removal, but recording transcription cannot invoke it.
- Live EOU text is provisional. The sealed Parakeet final remains the persisted source of truth after the meeting ends.
