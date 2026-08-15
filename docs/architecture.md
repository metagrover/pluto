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
│ 2. Local transcription policy                                          │
│    • MLX Whisper base: bounded live-preview chunks                      │
│    • Parakeet Core ML: canonical mic/system final validation            │
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

### 2. Local transcription (`python/mlx_preview_server.py`, `native/parakeet-runtime/`)

- **Live preview:** Apple MLX Whisper base converts sealed, bounded source chunks into responsive provisional text.
- **Final validation:** FluidAudio 0.15.5 runs Parakeet TDT 0.6B v3 int8 in a dedicated Swift/Core ML child process.
- **Source policy:** Complete microphone and system artifacts are recognized sequentially and reconciled without a whole-meeting mixed or MLX fallback.
- **Trust boundary:** Sealed capture evidence, explicit VAD, valid timings, and source coverage must pass before a generation-guarded canonical commit. Analysis starts only after that commit.
- **Resource boundary:** Full-meeting inference never runs in Electron or the MLX preview process. The native child can be cancelled or terminated independently and uses CPU plus Neural Engine with disk-backed long-form audio.
- **Admission and release:** Serious/critical thermal pressure or low free memory leaves final validation retryable without starting inference. Successful provider metadata records the actual int8/Core ML configuration and per-source aggregates; the native child unloads after five idle minutes.
- **Post-meeting ownership:** `App.tsx` schedules sealed provisional meetings through the persisted final-transcription worker after the recording component releases its critical path. A new capture cancels and unloads active Parakeet work. Once the generation-guarded canonical commit succeeds, a downstream-only worker analyzes those exact committed bytes and never invokes ASR again.

### 3. Local Speaker Diarization (`python/sherpa_diarization_runtime.py`)
- **Engine:** `sherpa-onnx` (C++ ONNX Runtime)
- **Purpose:** Computes voice feature embeddings across time windows to separate and label distinct speakers ("Speaker A", "Speaker B", or specific contacts).
- **Why separate from Whisper?**
  - Whisper models (including MLX Whisper) extract speech text tokens, but do **not** generate acoustic speaker embeddings or perform multi-speaker separation.
  - Sherpa-ONNX provides credential-free, offline local speaker attribution without requiring cloud API keys.

---

## 🔒 IPC & Process Lifecycle

1. **Electron Main Process (`electron/main.ts`):**
   - Manages the MLX preview HTTP server and the native Parakeet JSON-lines child separately.
   - Spawns Swift capture binaries when a meeting recording starts.
2. **Provider boundary (`electron/transcription/`):**
   - Routes bounded preview requests to MLX HTTP and canonical final requests to Parakeet standard input/output.
   - Correlates requests, enforces one final request at a time, sanitizes diagnostics, and preserves provider-neutral result contracts.
