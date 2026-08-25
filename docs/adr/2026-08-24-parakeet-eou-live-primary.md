# ADR: Use English Parakeet EOU as the only live transcription engine

- **Status:** Accepted
- **Date:** 2026-08-24
- **Source:** [Issue #663](https://github.com/metagrover/pluto/issues/663)

## Context

Pluto currently uses MLX Whisper for five-second live preview chunks and Parakeet TDT for canonical finalization. The pinned FluidAudio dependency also includes a true-streaming, English-only Parakeet EOU model with 320 ms advancement. The product is intentionally English-only, and the owner does not want an MLX transcription backup.

## Decision

Use independent Parakeet EOU sessions for causal microphone and System PCM as the only visible live recognizer. Require EOU readiness before recording, fail the live surface closed if EOU fails during capture, and keep durable capture running so sealed Parakeet TDT finalization remains canonical. Do not invoke MLX as startup or runtime fallback. Defer deleting MLX code and dependencies until the EOU path passes real-use gates.

## Alternatives

- **Retain MLX as a fallback:** rejected because it hides EOU failures, preserves two runtime contracts, and conflicts with the explicit product direction.
- **Feed five-second journal receipts to EOU:** rejected because receipt latency defeats true live transcription and couples presentation to durability batching.
- **Move audio capture into the native runtime:** rejected because current capture already exposes causal PCM and owns proven journal/recovery behavior.
- **Replace finalization with EOU immediately:** rejected because live hypotheses are preview state and do not yet carry the canonical integrity and reconciliation proof of the sealed batch path.

## Consequences

Recording startup now depends on verified EOU assets. Mid-recording recognition failure reduces live utility but cannot corrupt capture. Main/native protocol and packaging gain an EOU model contract. MLX code remains temporarily present but unreachable from recording transcription, and its complete removal becomes a separately verified follow-up.

