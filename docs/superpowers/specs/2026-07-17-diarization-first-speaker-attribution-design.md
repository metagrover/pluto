# Diarization-First Speaker Attribution Design

**Issue:** [#460](https://github.com/metagrover/pluto/issues/460)  
**Status:** Proposed for review  
**Scope:** Completed-recording finalization only

## Outcome

Pluto produces a final `Me`/`Them` transcript from canonical mixed audio without treating microphone-channel presence as speaker identity. The selected credential-free sherpa-onnx diarizer supplies speaker boundaries. Pluto assigns `Me` only when a boundary overlaps microphone-exclusive near-end evidence; system-correlated microphone energy is pass-through evidence, not local identity.

The first production slice must recover the consented private benchmark's genuine 0.541-second local interruption without introducing false-`Me` duration. The private audio, transcript, paths, and case identity remain local and gitignored.

## Existing System

Finalization currently has four relevant pieces:

1. `AudioManager` assembles a canonical transcript from chunk and full-session mic, mix, and system ASR.
2. `mapDiarizationSpeakers` maps diarization clusters against reference segments and activity windows that already carry `Me`/`Them` labels.
3. Diarization is requested through the WhisperX sidecar only when a Hugging Face token is configured.
4. Retry policy, speaker-attribution trust metadata, transcript integrity validation, and downstream persistence already exist.

This shape cannot close #460. A mic transcript containing loudspeaker bleed can become `Me` reference evidence before diarization runs, and the production path does not use the pinned credential-free runtime selected in #465/#509.

## Design Principles

- **Mixed audio owns words and speaker boundaries.** The final transcript is not a union of independently labeled channel transcripts.
- **Acoustic evidence owns local identity.** A diarization cluster becomes `Me` only from near-end evidence that excludes system-correlated pass-through.
- **Uncertainty is data.** Inconclusive mapping remains unknown or falls back with an explicit reason; it never invents `Me` from channel presence.
- **Finalization is resumable.** Model or mapping failure retains raw artifacts and produces a retryable trust state.
- **Private acceptance evidence stays private.** Repository tests use synthetic fixtures; consented recordings run through the gitignored benchmark manifest.

## Architecture

### 1. Credential-free diarization service boundary

Add a versioned Electron-side service that invokes the pinned sherpa-onnx adapter for canonical mixed audio and returns a content-free runtime envelope plus diarization intervals:

```ts
type LocalDiarizationResult = {
  schemaVersion: 1;
  turns: Array<{ startTime: number; endTime: number; cluster: string }>;
  runtime: {
    engine: "sherpa-onnx";
    engineVersion: "1.13.4";
    modelChecksums: string[];
    elapsedMs: number;
  };
};
```

The service validates model availability and checksums before inference and fails closed when the artifact is absent, incompatible, or altered. The renderer receives intervals and sanitized provenance, not model filesystem paths. Hugging Face configuration is not consulted for this path.

The existing benchmark adapter remains the executable reference for the selected runtime, but production IPC receives a narrow action and response contract rather than accepting arbitrary commands or candidate configuration.

### 2. Near-end evidence extraction

Add a pure acoustic-evidence stage that consumes aligned mic and system audio activity and emits evidence windows:

```ts
type AttributionEvidenceWindow = {
  startTime: number;
  endTime: number;
  nearEndScore: number;
  remoteScore: number;
  evidence: "mic_exclusive" | "system_correlated" | "inconclusive";
};
```

The initial implementation uses deterministic aligned energy evidence already available from the separate captures:

- mic activity without aligned system activity is `mic_exclusive` near-end evidence;
- aligned mic and system activity is `system_correlated` remote/pass-through evidence;
- silence, weak energy, missing alignment, or conflicting evidence is `inconclusive`.

Thresholds live in the transcription tuning contract, not in React components. The boundary permits a later true AEC residual implementation without changing cluster mapping or persistence.

Activity captured from live UI state may supplement diagnostics but cannot assign identity during finalization. Final attribution must be reproducible from retained recording artifacts.

### 3. Cluster-to-identity mapping

Replace channel-labeled reference mapping for the final path with a pure mapper over diarization turns and evidence windows. For each cluster, aggregate duration-weighted near-end and remote evidence.

Mapping rules:

- assign at most one cluster to `Me` in this two-party identity model;
- require minimum near-end duration and a minimum near-end-to-remote score margin;
- map other supported clusters to `Them` when remote evidence or the confident local assignment makes that safe;
- if no cluster clears the local threshold, preserve all clusters as `Them` or `Unknown` according to remote confidence—never promote a cluster from mic presence;
- inject a short `Me` boundary from a strong mic-exclusive window when diarization merged that window into a remote cluster, provided the window clears duration, energy, and isolation gates;
- keep overlap boundaries distinct when the diarizer reports overlap; an injected local window must not erase the remote turn.

The mapper returns labels plus evidence counts, confidence, and a finite fallback reason. It does not inspect transcript text.

### 4. Finalization orchestration

Move the production attribution sequence behind a service-level orchestrator callable from `AudioManager`:

1. Validate and retain mic, system, and canonical mixed artifacts.
2. Transcribe canonical mixed audio for words and timestamps.
3. Run credential-free diarization on the same mixed artifact.
4. Derive near-end evidence from aligned mic and system artifacts.
5. Map clusters and split canonical ASR segments at diarization/evidence boundaries.
6. Evaluate attribution confidence.
7. If confidence is low and a stronger eligible policy exists, retry once without persisting the first result.
8. Run transcript completeness/integrity validation on the attributed result.
9. Persist transcript, attribution trust metadata, and sanitized runtime provenance atomically.
10. Allow downstream analysis only after the final attributed transcript is persisted.

`AudioManager` remains responsible for UI/session coordination. It no longer owns model selection, acoustic thresholds, or cluster mapping details.

### 5. Trust and persistence

Extend the existing speaker-attribution metadata rather than creating a parallel record. The stored shape records:

- source: `local_diarization_acoustic` or an explicit fallback;
- mapping confidence;
- whether diarization and near-end evidence were attempted;
- finite fallback reason;
- engine version and model checksum identifiers;
- retry used and retry outcome;
- counts/durations of local, remote, overlap, and inconclusive evidence, without transcript text.

The transcript pipeline version increments because identity semantics materially change. Legacy transcripts remain readable. Reprocessing must be explicit and preserve the prior artifact until the replacement validates and saves successfully.

## Failure Behavior

- **Model missing or checksum mismatch:** do not download implicitly during finalization. Record a model-unavailable fallback, retain artifacts, and expose retryability.
- **Diarizer failure or timeout:** use the existing one-retry boundary when eligible, then persist a low-confidence fallback without claiming diarization-backed identity.
- **Mic or system artifact missing:** do not assign `Me` from the remaining channel. Record missing acoustic evidence and retain artifacts for recovery.
- **No local evidence:** a valid all-remote result is success, not a reason to invent a local cluster.
- **Short local evidence merged by diarization:** inject a bounded local turn only when mic-exclusive evidence clears the hard gates; otherwise remain uncertain.
- **Integrity validation fails:** do not release the transcript to downstream analysis. Preserve raw evidence and the prior valid transcript.

## Alternatives Considered

### A. Tune the existing channel-first mapper

Smallest code change, but it preserves the root defect: microphone capture containing loudspeaker bleed remains identity evidence. Rejected.

### B. Treat diarization cluster identity as stable across meetings

Avoids acoustic mapping but requires stored voiceprints or enrollment, expands privacy scope, and still cannot identify a short local turn merged into a remote cluster. Rejected.

### C. Diarization boundaries plus near-end acoustic evidence

Recommended. It separates word recognition, speaker boundaries, and local identity; uses Pluto's unique dual-channel evidence; stays local and credential-free; and directly targets the measured failure.

## Delivery Slices

The parent issue is too broad for one reviewable implementation PR. Deliver it as a short dependency-ordered stack:

1. **Production diarization boundary:** narrow IPC/service contract, pinned-model validation, sanitized provenance, and synthetic runtime tests.
2. **Near-end evidence and mapper:** pure aligned-evidence extraction, cluster mapping, short-turn injection, and synthetic pass-through/overlap/all-remote tests.
3. **Finalization integration:** canonical mixed ASR → diarization → evidence mapping → retry → integrity → atomic persistence; remove the Hugging Face token gate from the default production path.
4. **Acceptance and reprocessing:** committed benchmark assertions, private-manifest acceptance command, resumable reprocessing, and downstream gating verification.

Each child issue must be independently shippable and keep private evidence out of GitHub.

## Verification

### Focused unit tests

- model/version/checksum contract and sanitized errors;
- evidence classification for mic-exclusive, system-correlated, weak, delayed, and missing-channel windows;
- cluster mapping for pass-through, one short local turn, long local speech, overlap, all-remote, and inconclusive evidence;
- retry and fallback reason behavior;
- transcript schema migration and provenance;
- downstream analysis gating and atomic-save failure behavior.

### Integration and benchmark checks

- production service smoke test on Darwin arm64 with the pinned artifacts;
- committed synthetic attribution benchmark with zero false-`Me` regression;
- gitignored consented-private run that recovers the 0.541-second local turn while keeping false-`Me` duration at zero;
- full lint, test, changelog, and diff checks for every slice.

## Out of Scope

- named remote-speaker recognition;
- stored voiceprints or speaker enrollment;
- cloud transcription or diarization;
- outbound integrations or recording UI redesign;
- automatic reprocessing of every historical meeting;
- tuning legacy text-similarity attribution heuristics.

## Review Decisions Required

Reviewers should confirm these choices before implementation planning:

1. the first near-end stage uses deterministic aligned energy evidence behind an interface that can later host AEC residuals;
2. strong mic-exclusive evidence may inject a bounded short local turn when diarization merges it into a remote cluster;
3. #460 ships as the four dependency-ordered slices above rather than one broad PR;
4. missing acoustic evidence never falls back to microphone-channel identity.
