# Pluto Audio & Meeting Intelligence Architecture

This document describes the high-level architecture of Pluto's local meeting capture, speech-to-text, and speaker attribution pipeline.

---

## 🏗 High-Level Audio Processing Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│                        🎙️ macOS Hardware                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Swift Native Core (`audiocap` / `AudioRecorder`)                    │
│    • Frameworks: ScreenCaptureKit, CoreAudio, AVFoundation             │
│    • Responsibility: Low-latency capture of System Audio & Mic         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. Native Apple Silicon MLX Whisper (`mlx-whisper` / `whisperx_server`)│
│    • Acceleration: Apple Neural Engine (ANE) + Metal GPU               │
│    • Responsibility: Converts raw audio to text & word timestamps      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. Sherpa-ONNX Diarization Engine (`sherpa-onnx` C++ Runtime)          │
│    • Models: Local CAM++ / ECAPA-TDNN ONNX embeddings                  │
│    • Responsibility: Identifies speaker identities ("John", "Sarah")   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     📝 Finalized Meeting Transcript                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Component Responsibilities & Boundaries

### 1. Swift Native Core (`resources/swift/`)
- **Binaries:** `resources/bin/audiocap`, `resources/bin/recorder`
- **Purpose:** Direct interaction with macOS hardware audio subsystems.
- **Why Swift?**
  - **ScreenCaptureKit:** Required on macOS 13+ to capture internal desktop/app audio (Zoom, Google Meet, Slack, Teams) without virtual audio cables.
  - **TCC Entitlements:** Executes with signed macOS code signatures for Microphone and Screen Recording user privacy permissions.

### 2. Native Apple Silicon MLX Whisper (`python/whisperx_server.py`)
- **Engine:** Apple `mlx-whisper` (`local_alt_apple_silicon`)
- **Purpose:** Converts raw 16kHz PCM audio into accurate text transcripts with millisecond word-level timestamps.
- **Why MLX?**
  - Runs natively on Apple Neural Engine (ANE) and Metal GPU via unified memory.
  - Achieves 15x–25x real-time speed on Apple Silicon (M1/M2/M3/M4) with zero accuracy degradation.
  - Falls back to PyTorch `whisperx` CPU execution on non-Apple-Silicon platforms.

### 3. Local Speaker Diarization (`python/sherpa_diarization_runtime.py`)
- **Engine:** `sherpa-onnx` (C++ ONNX Runtime)
- **Purpose:** Computes voice feature embeddings across time windows to separate and label distinct speakers ("Speaker A", "Speaker B", or specific contacts).
- **Why separate from Whisper?**
  - Whisper models (including MLX Whisper) extract speech text tokens, but do **not** generate acoustic speaker embeddings or perform multi-speaker separation.
  - Sherpa-ONNX provides credential-free, offline local speaker attribution without requiring cloud API keys.

---

## 🔒 IPC & Process Lifecycle

1. **Electron Main Process (`electron/main.ts`):**
   - Manages the lifecycle of the bundled `whisperx_server` executable (`resources/bin/whisperx_server`) on `localhost:5123`.
   - Spawns Swift capture binaries when a meeting recording starts.
2. **Sidecar Communication (`electron/transcription.ts`):**
   - Communicates via HTTP REST endpoints (`/transcribe`, `/diarize`, `/attribution/aligned-energy`, `/health`).
   - Ensures warm model state in memory for 0ms request initialization.
