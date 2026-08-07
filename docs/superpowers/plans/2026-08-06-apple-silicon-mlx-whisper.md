# Implementation Plan: Native Apple Silicon MLX Whisper Engine

- **Issue:** [#593](https://github.com/metagrover/pluto/issues/593)
- **Spec:** [docs/superpowers/specs/2026-08-06-apple-silicon-mlx-whisper-design.md](file:///Users/metagrover/Desktop/pluto/docs/superpowers/specs/2026-08-06-apple-silicon-mlx-whisper-design.md)

## Proposed Changes

### 1. Python Environment & Server (`python/`)
- Add `mlx-whisper` and `mlx` to `python/requirements.txt`.
- Implement `mlx_whisper` transcription branch in `python/whisperx_server.py`:
  - Detect `mlx_whisper` availability.
  - Implement MLX transcription handler with word-level timestamps.
  - Map model standard names to `mlx-community` HF repos.
  - Support fallback to standard `whisperx` if MLX fails or is unavailable.

### 2. Frontend & Configuration (`src/` and `electron/`)
- Update `src/utils/transcriptionBackendConfig.ts`:
  - Enable `local_alt_apple_silicon` backend for Apple Silicon (`darwin`/`arm64`).
  - Configure options for `local_alt_apple_silicon` (`device: 'mlx' | 'cpu'`).
- Update `electron/transcription.ts` to pass `local_alt_apple_silicon` backend requests to python sidecar.
- Update `src/components/overlays/SettingsOverlay.tsx` to properly display `Local Alt (Apple Silicon)` option when available.

### 3. Tests & Verification
- Unit test `transcriptionBackendConfig.ts` capability logic with `vitest`.
- Unit test Python `whisperx_server.py` endpoints.
- Run actual performance comparison on meeting audio files stored in Pluto's meeting storage or tests directory.

### 4. Durable Documentation & Changelog
- Update `docs/decisions.md`.
- Add fragment to `docs/changelog/entries/`.
