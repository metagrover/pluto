### Native Apple Silicon MLX Whisper Transcription Engine
- **Issue:** [#593](https://github.com/metagrover/pluto/issues/593)
- **PR:** [#593](https://github.com/metagrover/pluto/pull/593)
- **Changed:** Integrated Apple MLX (`mlx-whisper`) as a native Apple Silicon Neural Engine & GPU transcription engine in `python/whisperx_server.py` under the `local_alt_apple_silicon` backend identifier. Added engine selection in Pluto Settings Overlay.
- **Why:** PyTorch WhisperX runs on CPU on macOS due to PyTorch 2.0 MPS limitations. `mlx-whisper` leverages Apple Neural Engine (ANE) and Metal GPU for 15x-20x faster real-time transcription with lower memory footprint and zero loss in accuracy.
- **Replaced:** CPU-only PyTorch Whisper fallback on macOS arm64.
- **Notes:** Retains full compatibility with Sherpa-ONNX speaker diarization and audio energy window alignment.
