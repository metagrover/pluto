### Make Transcription Apple Silicon MLX-only

- **Issue:** [#596](https://github.com/metagrover/pluto/issues/596)
- **PR:** [#597](https://github.com/metagrover/pluto/pull/597)
- **Changed:** Pluto now runs speech-to-text exclusively with MLX Whisper on Apple Silicon, keeps local Sherpa speaker attribution separate, and replaces complete legacy CPU checkpoint sets from durable repair audio before transcript validation.
- **Why:** Historical WhisperX CPU settings could switch the shared transcription process away from the working MLX engine during recovery, leaving completed meetings stuck while also carrying unused PyTorch dependencies.
- **Replaced:** PyTorch WhisperX startup and fallback, CPU/CUDA runtime options, cross-platform packaging targets, token-backed WhisperX diarization, and backend/device/compute settings.
- **Notes:** Model, quality preset, and language intent remain supported. Missing MLX fails explicitly, recovery stays content-free in diagnostics, and Intel Macs, Windows, and Linux are out of scope.
