# ADR: Use Parakeet Core ML for canonical final transcription

- **Status:** Accepted
- **Date:** 2026-08-15
- **Issue:** [#441](https://github.com/metagrover/pluto/issues/441)

## Context

MLX Whisper base is responsive enough for Pluto's five-second live-preview chunks, but whole-meeting MLX recognition can consume unified memory without a safe process boundary. Two observed runs coincided with roughly 12 GB application memory and a frozen system. The final transcript also needs a stronger quality contract than the provisional preview.

## Decision

Pluto uses two explicit local policies on Apple Silicon:

- MLX Whisper base produces bounded live-preview chunks.
- A Pluto-owned Swift process using FluidAudio 0.15.5 and Parakeet TDT 0.6B v3 int8 produces the canonical final transcript.

The Parakeet process downloads pinned model revisions into Pluto's model directory, uses Core ML CPU plus Neural Engine, and transcribes complete microphone and system artifacts sequentially. Electron communicates over correlated JSON lines and may terminate the child independently. Pluto never uses whole-session MLX as fallback.

The provisional transcript remains durable until sealed evidence passes final validation. A generation-guarded commit replaces it atomically, and only the exact committed canonical transcript can start analysis. Runtime, model, timing, or integrity failures preserve the recording and provisional transcript in a retryable `needs_attention` state.

## Consequences

The first preparation has a substantial local model download and setup cost. Finalization can take longer, but download size and latency are subordinate to quality and memory safety. Live and final provider identities are observable, private meeting content remains local, and real-meeting evaluation reports only aggregate accuracy, timing, and resource metrics.

Parakeet streaming is not adopted by this decision. It requires separate evidence for first-text latency, cadence, stop behavior, and thermal impact.
