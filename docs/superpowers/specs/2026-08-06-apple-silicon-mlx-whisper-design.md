# Design Spec: Native Apple Silicon MLX Whisper Transcription Engine

- **Issue:** [#593](https://github.com/metagrover/pluto/issues/593)
- **Author:** Antigravity AI
- **Date:** 2026-08-06
- **Status:** Approved

---

## 1. Overview

Pluto requires high-performance, low-latency, production-grade transcription on Apple Silicon Macs (M1/M2/M3/M4). Currently, PyTorch `whisperx` defaults to CPU execution on macOS due to PyTorch 2.0 MPS limitations in older dependencies. This design introduces native support for **`mlx-whisper`** (Apple MLX Framework) in `python/whisperx_server.py` under the existing `local_alt_apple_silicon` backend identifier.

## 2. Architecture & Components

### 2.1 Python Sidecar (`python/whisperx_server.py`)
- **Engine Switching:** Introduce an `engine` selection mechanism in `whisperx_server.py`:
  - `whisperx` (default fallback engine, PyTorch/CTranslate2).
  - `mlx_whisper` (Apple Neural Engine & Metal GPU backend for `darwin` / `arm64`).
- **Model Resolution:** Map model requested names to MLX HuggingFace repository models:
  - `tiny` -> `mlx-community/whisper-tiny`
  - `base` -> `mlx-community/whisper-base`
  - `small` -> `mlx-community/whisper-small`
  - `medium` -> `mlx-community/whisper-medium`
  - `large-v2` -> `mlx-community/whisper-large-v2`
  - `large-v3` -> `mlx-community/whisper-large-v3-turbo`
- **Output Format Normalization:** `mlx_whisper.transcribe` returns word-level timestamps (`words` key). `whisperx_server.py` normalizes this output into Pluto's expected segment schema (`segments`, `words`, `language`, `vad`, `active_config`), maintaining complete compatibility with downstream Sherpa-ONNX diarization and energy window alignment.

### 2.2 Frontend & Backend Config (`src/utils/transcriptionBackendConfig.ts` & `electron/transcription.ts`)
- Mark `local_alt_apple_silicon` backend as fully available when running on `darwin` + `arm64`.
- Add proper device/compute handling for `local_alt_apple_silicon` (`device: 'mlx'`, `computeType: 'float16'`).
- Expose engine health status in `/health`.

## 3. Performance & Quality Benchmarking Strategy

- Execute comparative benchmark across recent recorded meetings between:
  1. `whisperx_current` (PyTorch CPU int8)
  2. `local_alt_apple_silicon` (`mlx-whisper` Metal/ANE float16)
- Benchmark Metrics:
  - Transcription Elapsed Time (ms)
  - Real-time Factor (RTF = Elapsed Time / Audio Duration)
  - Segment Count & Character Length
  - Memory & CPU Utilization

## 4. Fallback Safety
- If `mlx-whisper` is missing or fails to initialize on an unsupported machine, `whisperx_server.py` automatically falls back to standard `whisperx` CPU engine with a clear log warning.
