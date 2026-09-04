# Recording Start Readiness Design

Issue: #742

## Outcome

A single New meeting action starts a meeting even when the Parakeet runtime was intentionally unloaded after its idle timeout. Pluto keeps the existing recording workspace in its explicit starting state while the runtime prepares, then continues the same admission attempt.

## Design

Recording admission will invoke the existing `RECORDING_READINESS_PREPARE` boundary instead of the read-only `RECORDING_READINESS_STATUS` boundary. Preparation is already single-flight and cached while warm; after idle unload it restarts and verifies the native runtime before capture-journal ownership is acquired. The existing readiness result remains authoritative for AudioCap, microphone, system-audio permission, model, and EOU capability blockers.

The renderer continues to publish `starting` synchronously before awaiting readiness. The recording header therefore shows `Starting recording`, `Preparing capture`, and a disabled `Starting` action throughout warm-up. Only successful microphone and durable capture startup publishes `recording`. A failed preparation retains the existing fail-closed readiness recovery behavior.

## Testing

Extend the AudioManager startup-boundary regression to require preparation, not a status-only check, between the synchronous starting claim and capture-journal startup. Retain the existing tests for single-flight preparation, idle unload, duplicate-start exclusion, and recording-state publication after microphone capture.

