# ADR: Retire the MLX transcription runtime

- **Status:** Accepted
- **Date:** 2026-08-25
- **Source:** [Issue #663](https://github.com/metagrover/pluto/issues/663)
- **Supersedes:** The temporary MLX-retention consequence in [the Parakeet EOU ADR](./2026-08-24-parakeet-eou-live-primary.md)

## Context

Parakeet EOU is now Pluto's only visible live recognizer and Parakeet TDT is the canonical post-meeting recognizer. Real meetings verified that boundary. The unused MLX runtime still imposed a Python sidecar, model dependency, build and package hooks, IPC/settings contracts, private comparison runners, and rollback state that could imply MLX remained a supported fallback.

## Decision

Remove every executable MLX transcription path and the obsolete dual-shadow rollout machinery built to compare or fall back to it. App builds package only the native capture and Parakeet runtimes. Local speaker-attribution benchmarks no longer expose an MLX ASR candidate.

Retain the literal legacy backend identifier only inside capture-journal recovery so journals created by older Pluto versions can still validate their checkpoint checksums. That parser is read-only compatibility and has no runtime launch path.

## Consequences

Python is no longer required for app transcription or app packaging. Recording readiness, live text, finalization, vocabulary bias, and diagnostics all have one Parakeet contract. MLX cannot be selected, launched, packaged, benchmarked, or used as rollback. Historical documentation remains intact as an audit trail and is explicitly superseded here.
