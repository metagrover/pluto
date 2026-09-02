# Diarization-First Speaker Attribution Restoration

**Issue:** [#725](https://github.com/metagrover/pluto/issues/725)
**Status:** Approved
**Date:** 2026-09-02

## Problem

Pluto's current Parakeet final-transcription path assigns speaker identity from capture channel alone: microphone words become `Me` and system words become `Them`. Cross-channel reconciliation then prefers the system copy of duplicated speech. This is useful source evidence, but it is not speaker identity. Acoustic echo, speakerphone pickup, and overlap can therefore turn a sentence spoken by the local user into a canonical `Them` segment.

The regression is systemic. The current saved-transcript metadata can report `source: channel_fallback`, `confidence: 0`, `diarizationAttempted: false`, and `mappingApplied: false` while the meeting is otherwise treated as validated. Downstream notes and analysis can then consume speaker labels that Pluto never acoustically verified.

## Goals

1. Restore offline, diarization-first attribution for newly finalized meetings.
2. Use mic/system recordings as acoustic evidence for anonymous diarization clusters, never as identity by themselves.
3. Preserve short local interruptions that cross-channel de-duplication would otherwise erase.
4. Fail closed when attribution confidence is insufficient: keep the provisional transcript visible, make finalization retryable, and block downstream intelligence.
5. Offer an explicit safe retry for historical meetings whose attribution is missing, confidence-zero, or channel-fallback.
6. Keep all meeting audio and identity inference local to the Mac.

## Non-goals

- Named-speaker recognition or reusable voiceprints.
- Cloud diarization or uploading private meeting audio.
- Automatic rewriting of historical transcripts.
- Reintroducing the retired Python/WhisperX sidecar.
- Acoustic echo cancellation. Pluto will use bounded source-energy evidence rather than attempt to reconstruct echo-free audio.
- Treating channel origin, calendar attendance, or participant names as verified identity.

## Chosen approach

Extend Pluto's existing native Parakeet runtime with one sealed-file `speaker_evidence` operation. It uses FluidAudio's offline Core ML diarizer on the mixed recording and computes aligned RMS windows from the immutable microphone and system recordings. The runtime returns anonymous diarization turns and content-free energy measurements. TypeScript applies Pluto's existing attribution policy to map at most one anonymous cluster to `Me`, map supported remaining clusters to `Them`, and leave unsupported clusters unknown.

This keeps model execution, audio decoding, path enforcement, cancellation, and memory-bounded file processing in the existing native trust boundary. It also avoids rebuilding a second runtime stack solely for diarization.

## Data flow

1. Capture seals microphone, system, and mixed audio artifacts and records their generation.
2. Parakeet transcribes microphone and system artifacts independently as it does today.
3. The final worker sends `speaker_evidence` with the sealed mixed, microphone, and system paths.
4. The native runtime:
   - approves all three paths under the configured meeting-audio root;
   - loads a pinned, integrity-verified FluidAudio offline diarization model bundle;
   - diarizes the mixed file using the disk-backed API;
   - scans microphone and system files into fixed, aligned RMS windows without retaining whole-meeting PCM in memory;
   - returns anonymous turns, energy windows, model provenance, and timing metadata.
5. TypeScript derives `mic_exclusive`, `system_correlated`, and `inconclusive` evidence windows.
6. Pluto maps at most one sufficiently supported diarization cluster to `Me`. It maps other sufficiently supported clusters to `Them`; unsupported clusters stay `Unknown`.
7. Word segments are aligned to diarization turns. Existing bounded local-evidence injection restores short genuine local interruptions only when mic-exclusive evidence meets duration and coverage thresholds.
8. Cross-channel bleed collapse runs with acoustic identity evidence available and must not override a supported `Me` attribution merely because a duplicate system copy exists.
9. The canonical transcript commits only if transcript integrity and speaker-attribution acceptance both pass.
10. Downstream notes and analysis start only after that canonical commit.

## Native protocol

Add `speaker_evidence` to schema version 1. The request contains:

- `id`
- `method: "speaker_evidence"`
- `mixedAudioPath`
- `micAudioPath`
- `systemAudioPath`

All paths are required regular files beneath the runtime's approved audio root. Model roots remain process configuration, not caller-selected paths.

The success response contains:

- diarization turns: `startTime`, `endTime`, and opaque `cluster`
- aligned energy windows: `startTime`, `endTime`, `micRms`, and `systemRms`
- provenance: model identifier, immutable revision, artifact digest, runtime version
- timings and window size

It contains no transcript text, filenames, participant names, embeddings, or reusable biometric material. Failures use typed runtime codes for invalid request, disallowed path, model preparation failure, audio analysis failure, cancellation, and diarization failure.

The operation participates in the existing request coordinator so cancellation and shutdown suppress late results. Only one heavyweight finalization operation may own the native runtime lease at a time.

## Model lifecycle and integrity

The offline diarization repository and exact revision are production constants. Required model artifacts are enumerated and verified by SHA-256 before activation. Downloads go to staging, compilation completes there, and the directory becomes active only after revision and artifact verification. An existing active version remains usable until its replacement is complete. A corrupt or partial bundle is never loaded.

The app's packaged native runtime contains the implementation but not meeting data. Preparation uses the same local model storage and progress/error conventions as Parakeet. Production tests assert that the repository is not `main`, that the revision is a full immutable commit, and that every required diarization artifact has a non-placeholder digest.

## Attribution trust contract

Channel origin is evidence, not identity. A canonical transcript may use `Me` or `Them` only when the stored attribution record says diarization was attempted and the acoustic mapping passed acceptance.

The stored attribution record includes:

- `source: "offline_diarization_acoustic_v1"`
- `diarizationAttempted: true`
- `mappingApplied`
- bounded confidence and acceptance measurements
- model/runtime provenance
- fallback reason when rejected

Acceptance reuses `productionSpeakerAttributionAcceptance`: false-`Me` evidence is a zero-tolerance safety gate, missed-`Me` evidence is bounded, and mapping confidence must meet the production threshold. `Unknown` is preferable to a confident but unsupported label.

If mixed audio is missing, the model is unavailable, diarization fails, acoustic evidence is absent, or acceptance fails, Pluto does not convert channel fallback into a validated canonical transcript. It marks final transcription `needs_attention`, retains the provisional transcript for reading, records a content-free failure reason, and leaves downstream processing blocked.

## Historical retry

The existing meeting retry action becomes eligible when a saved transcript has channel-fallback, confidence-zero, missing, or rejected speaker attribution and sealed source audio is still available. The retry runs the exact current finalization pipeline; it is not a separate repair algorithm.

Retry claims a lease tied to the meeting ID, capture generation, source paths, and prior transcript digest. Commit is compare-and-save: if the meeting, source generation, transcript, or retry ownership changed while work was running, the result is superseded and nothing is overwritten. Successful retry replaces the canonical transcript and restarts downstream processing from the corrected evidence. Failed retry preserves the prior visible transcript and explanatory state.

No historical meeting is reprocessed automatically. This limits compute, avoids surprise rewrites, and keeps correction user-directed.

## Product behavior

The meeting view continues to use the existing retry/recovery affordance. For attribution failures, its explanation states that Pluto could not verify who spoke and that retry will re-run private on-device attribution from saved audio. The UI does not expose anonymous cluster IDs, energy scores, or model internals.

During normal finalization, attribution is a visible finalization stage rather than a silent background rewrite. The meeting remains readable while the canonical result is pending.

## Privacy and diagnostics

- Audio stays on device.
- Logs and diagnostics contain request IDs, durations, aggregate counts, timings, model version, confidence, and failure codes only.
- Transcript text, audio paths, participant names, embeddings, and per-window energy arrays are excluded from production logs.
- The canonical transcript stores attribution decisions and bounded aggregate evidence, not speaker embeddings.

## Verification

### Unit and contract tests

- Protocol decoding rejects missing, incompatible, oversized, and out-of-root paths.
- Cancellation and shutdown suppress late speaker-evidence results.
- Model preparation pins an immutable revision and rejects missing or mismatched artifacts.
- Energy analysis produces deterministic aligned windows for synthetic WAV fixtures, including unequal duration and silence.
- Cluster mapping identifies at most one local cluster and leaves insufficient evidence unknown.
- Word-to-turn alignment handles overlap and gaps deterministically.
- Cross-channel collapse cannot replace an acoustically supported local turn with a system duplicate.
- Finalization fails closed for unavailable models, absent mix, empty turns, missing energy evidence, and rejected acceptance.
- Retry compare-and-save rejects stale generation, transcript, or ownership.

### Integration and production evidence

- Swift package tests cover the real FluidAudio adapter without downloading models in ordinary unit tests.
- TypeScript integration tests cover finalization, persistence, downstream gating, and manual retry.
- Native and Electron builds prove the new protocol is present in emitted and packaged runtime artifacts.
- A content-free replay over private saved meetings reports only aggregate false-`Me`, missed-`Me`, unknown, confidence, and runtime measurements. Private transcript text and paths never enter Git, issue comments, or committed artifacts.
- Rendered app validation confirms the attribution stage and retry explanation when the target runtime state is available. If it is not available, the delivery report distinguishes automated UI coverage from rendered evidence.

## Rollout

1. Land protocol, model integrity, native diarization, and acoustic evidence behind the finalization worker.
2. Enforce fail-closed canonical commit and downstream gating.
3. Enable the existing explicit retry for eligible historical meetings.
4. Verify with synthetic fixtures, a content-free private replay, native build, Electron build, and packaged runtime inspection.
5. Monitor aggregate failure codes and timing locally; do not add telemetry containing meeting content.

## Success criteria

- Newly validated meetings never claim verified `Me`/`Them` attribution from channel fallback alone.
- The reported regression class is correctable through the same safe retry path without editing the database directly.
- A failed or ambiguous attribution cannot silently feed notes, commitments, projects, or People intelligence.
- Runtime and persistence behavior remain local, bounded, cancelable, integrity-verified, and recoverable.
