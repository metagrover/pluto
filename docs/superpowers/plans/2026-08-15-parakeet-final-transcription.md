# Parakeet Final Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep MLX live preview while making a Pluto-owned FluidAudio/Parakeet v3 per-channel pass the required canonical transcript before analysis.

**Architecture:** Introduce provider-neutral transcription policy contracts, a persistent Swift Parakeet runtime, an Electron client, and an app-wide final-validation orchestrator. Final recognition is sequential per source, integrity-gated, conditionally persisted, and never falls back to whole-meeting MLX. Remove obsolete WhisperX/backend settings after the cutover.

**Tech Stack:** TypeScript 5.9, Electron 40, React 18, Vitest 4, Swift 6, Swift Package Manager, FluidAudio 0.15.5, Core ML, SQLite, Biome.

---

### Task 1: Provider-neutral policy contracts

**Files:**
- Create: `src/services/transcription/contracts.ts`
- Create: `src/services/transcription/policy.ts`
- Test: `tests/unit/transcriptionPolicy.test.ts`

- [x] **Step 1: Write the failing policy tests**

```ts
expect(resolveTranscriptionPolicy('live_preview')).toMatchObject({
  role: 'live_preview', engine: 'mlx_whisper', model: 'base',
});
expect(resolveTranscriptionPolicy('final_validation')).toMatchObject({
  role: 'final_validation', engine: 'parakeet_coreml', model: 'parakeet-tdt-0.6b-v3',
  maxConcurrency: 1,
});
expect(() => assertPolicySupported('final_validation', { platform: 'linux', arch: 'x64' }))
  .toThrow('transcription_platform_unsupported');
```

- [x] **Step 2: Run `pnpm exec vitest run tests/unit/transcriptionPolicy.test.ts` and verify the missing-module failure**

- [x] **Step 3: Implement exact role, engine, result, word, VAD, health, and metadata types plus the fixed Apple Silicon resolver**

```ts
export type TranscriptionPolicyRole = 'live_preview' | 'final_validation';
export type TranscriptionEngine = 'mlx_whisper' | 'parakeet_coreml';
export const resolveTranscriptionPolicy = (role: TranscriptionPolicyRole) =>
  role === 'live_preview' ? LIVE_PREVIEW_POLICY : FINAL_VALIDATION_POLICY;
```

- [x] **Step 4: Re-run the test and verify it passes**

- [x] **Step 5: Commit with `git commit -am "feat(transcription): define live and final policies (#441)"`**

### Task 2: Native protocol and path safety

**Files:**
- Create: `native/parakeet-runtime/Package.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/PathPolicy.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ProtocolTests.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/PathPolicyTests.swift`

- [x] **Step 1: Add Swift tests for decoding prepare/transcribe/cancel requests, encoding sanitized failures, and rejecting relative, escaped, symlinked, or outside-root paths**

```swift
#expect(throws: RuntimeFailure.self) {
    try PathPolicy(root: approvedRoot).approve(URL(fileURLWithPath: "../private.wav"))
}
#expect(response.error?.code == "parakeet_path_not_allowed")
#expect(encodedResponse.contains("private.wav") == false)
```

- [x] **Step 2: Run `swift test --package-path native/parakeet-runtime --filter 'ProtocolTests|PathPolicyTests'` and verify RED**

- [x] **Step 3: Implement a versioned JSON-lines protocol and canonical descendant validation using standardized/resolved URLs and regular-file checks**

- [x] **Step 4: Re-run Swift tests and verify GREEN**

- [x] **Step 5: Commit `native/parakeet-runtime` protocol/core files**

### Task 3: Managed Parakeet model and ASR engine

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ModelManifest.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ModelStore.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ParakeetTranscriber.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntime/main.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ModelStoreTests.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/TranscriberTests.swift`
- Create: `resources/model-manifests/parakeet-tdt-0.6b-v3.json`
- Create: `resources/model-manifests/FluidAudio-NOTICE.txt`
- Modify: `package.json`
- Modify: `electron-builder.json5`

- [x] **Step 1: Write failing tests for immutable activation state, failed preparation preserving the active version, one-time model loading, serialized requests, fresh decoder state, and content-free errors**

- [x] **Step 2: Run the Swift core suite and verify the missing implementations fail**

- [x] **Step 3: Pin FluidAudio 0.15.5 in `Package.swift`; implement `ModelStore` around a Pluto-owned root and an injected downloader/loader so lifecycle tests remain offline**

- [x] **Step 4: Implement the production engine with `AsrModels.downloadAndLoad(to:version:encoderPrecision:)`, `AsrManager`, `.cpuAndNeuralEngine`, disk-backed long-form transcription, token timings, explicit language, confidence, and VAD-compatible empty output**

- [x] **Step 5: Add bounded known-person vocabulary rescoring using FluidAudio's CTC spotter/rescorer; persist only vocabulary policy/count**

- [x] **Step 6: Implement the persistent service read loop, request correlation, cancellation, serialized ASR actor, and sanitized stderr behavior**

- [x] **Step 7: Add `build:parakeet` to produce/sign `resources/bin/parakeet-runtime`, include manifests/notices in `extraResources`, and run `swift test` plus `pnpm run build:parakeet`**

- [x] **Step 8: Commit the native runtime and build integration**

### Task 4: Electron Parakeet process client

**Files:**
- Create: `electron/transcription/parakeetFinalClient.ts`
- Create: `electron/transcription/nativeJsonLineProcess.ts`
- Test: `tests/unit/parakeetFinalClient.test.ts`

- [x] **Step 1: Write failing tests with a fake child process for one shared start, request correlation, sequential submission, cancellation, timeout, malformed lines, child exit, approved roots, and sanitized diagnostics**

```ts
const first = client.transcribe(firstRequest);
const second = client.transcribe(secondRequest);
expect(child.stdin.write).toHaveBeenCalledTimes(1);
emitSuccess(firstId);
await first;
expect(child.stdin.write).toHaveBeenCalledTimes(2);
```

- [x] **Step 2: Run the focused Vitest file and verify RED**

- [x] **Step 3: Implement the JSON-line process adapter and Parakeet client with injected spawn/clock/path resolution**

- [x] **Step 4: Re-run the client tests and verify GREEN**

- [x] **Step 5: Commit the Electron client**

### Task 5: Timing validation and provider-neutral segmentation

**Files:**
- Create: `src/services/finalTranscription/segmentRecognizedWords.ts`
- Test: `tests/unit/segmentRecognizedWords.test.ts`

- [ ] **Step 1: Write failing tests for punctuation, 800 ms silence, 15-second, and 40-word boundaries; exact word conservation; invalid/non-finite/out-of-order/beyond-duration rejection; and empty no-speech handling**

```ts
expect(flattenWords(segmentRecognizedWords(words, duration))).toEqual(words);
expect(() => segmentRecognizedWords(overlappingWords, duration))
  .toThrow('transcription_word_timing_invalid');
```

- [ ] **Step 2: Verify RED with focused Vitest**

- [ ] **Step 3: Implement the pure segmenter without linguistic rewriting**

- [ ] **Step 4: Verify GREEN and commit**

### Task 6: Quality-first final-validation orchestrator

**Files:**
- Create: `src/services/finalTranscription/runFinalTranscription.ts`
- Create: `src/services/finalTranscription/finalTranscriptionLease.ts`
- Test: `tests/unit/runFinalTranscription.test.ts`
- Test: `tests/unit/finalTranscriptionLease.test.ts`

- [ ] **Step 1: Write failing tests proving sealed-evidence requirement, mic-then-system sequencing, no mix request when both channels exist, source speaker ownership, explicit no-speech acceptance, failed empty rejection, integrity failure, conditional-save conflict, cancellation, and downstream handoff only after canonical commit**

```ts
expect(transcribe.mock.calls.map(([request]) => request.source)).toEqual(['mic', 'system']);
expect(events).toEqual(['commit-canonical', 'start-analysis']);
```

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement a dependency-injected orchestrator that reuses `runRecordingTranscriptValidation`, `reconcileCanonicalTranscript`, and transcript schema/integrity helpers**

- [ ] **Step 4: Persist `parakeet_final_v1` policy/model/source metadata and finite failure reasons through the lease boundary; unavailable, failed, or integrity-rejected results retain the provisional transcript with `needs_attention`**

- [ ] **Step 5: Verify GREEN and commit**

### Task 7: Wire final validation into persistence and analysis handoff

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/db.ts`
- Modify: `src/App.tsx`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `src/services/recordingTranscriptValidation.ts`
- Modify: `src/utils/transcriptSchema.ts`
- Test: `tests/unit/retryMeetingTranscriptValidation.test.ts`
- Test: `tests/unit/transcriptSchema.test.ts`
- Create: `tests/unit/finalTranscriptionStartupBoundary.test.ts`

- [ ] **Step 1: Add failing persistence/startup tests proving Parakeet preparation precedes retry recovery, final validation claims one lease, canonical commit is generation-bound, and analysis receives the exact committed transcript**

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Register `TRANSCRIPTION_TRANSCRIBE`, prepare/status/cancel IPC handlers and route final policy to the native client while retaining MLX live/recovery chunk routing**

- [ ] **Step 4: Replace the checkpoint-only validation shortcut with the final orchestrator; keep provisional persistence but delay downstream analysis until final commit**

- [ ] **Step 5: Add conditional database operations and restart recovery for interrupted final-validation leases**

- [ ] **Step 6: Verify focused persistence, retry, finalization, and analysis tests; commit**

### Task 8: Remove stale transcription code and settings

**Files:**
- Rename: `electron/whisperx.ts` to `electron/transcription/mlxPreviewClient.ts`
- Rename: `python/whisperx_server.py` to `python/mlx_transcription_server.py`
- Rename: `python/whisperx_server.spec` to `python/mlx_transcription_server.spec`
- Modify: `scripts/setup_python.sh`
- Modify: `scripts/build_python.sh`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/components/overlays/SettingsOverlay.tsx`
- Modify: `src/utils/transcriptionSettings.ts`
- Modify: `src/utils/transcriptionBackendConfig.ts`
- Modify: `src/utils/browserIpcFallback.ts`
- Modify: affected tests and imports
- Delete: disabled full-session MLX fallback/hydration code made unreachable by the final worker

- [ ] **Step 1: Add/update tests asserting there are no legacy WhisperX/CPU/CUDA/MPS/backend choices or `WHISPER_TRANSCRIBE` callers**

- [ ] **Step 2: Verify the cleanup tests fail**

- [ ] **Step 3: Migrate names/contracts, remove ignored settings and compatibility aliases, extract remaining finalization helpers from `AudioManager.tsx`, and delete dead whole-session MLX branches**

- [ ] **Step 4: Run `rg -n "WHISPER_TRANSCRIBE|whisperx_current|whisperx_tuned|local_alt_apple_silicon|device: 'cpu'|device: 'cuda'" src electron python scripts tests` and justify every remaining historical/documentation occurrence**

- [ ] **Step 5: Run focused and full tests, then commit cleanup**

### Task 9: Benchmark, decisions, documentation, and changelog

**Files:**
- Modify: `src/services/recordingQualityBenchmark.ts`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `scripts/recording-quality/baselines/current-master.json`
- Create: synthetic final-policy fixtures under `scripts/recording-quality/fixtures/`
- Create: `scripts/validate_private_transcription_manifest.ts`
- Modify: `package.json`
- Create: `docs/adr/2026-08-15-parakeet-final-transcription.md`
- Modify: `docs/decisions.md`
- Modify: `docs/architecture.md`
- Modify: `docs/dev.md`
- Create: `docs/changelog/entries/2026-08-15-441-parakeet-final-transcription.md`

- [ ] **Step 1: Add failing synthetic benchmark cases for policy selection, readiness failure, silence, overlap/deduplication, and analysis handoff plus stable accuracy/integrity metrics**

- [ ] **Step 2: Verify the benchmark fails before implementation fixtures/baseline update**

- [ ] **Step 3: Implement benchmark adapters and a content-free private-manifest validator; never commit private outputs**

- [ ] **Step 4: Record the superseding architecture decision, rationale, consequences, model/license ownership, and removal of whole-session MLX**

- [ ] **Step 5: Run `pnpm run benchmark:recording-quality` and `pnpm run changelog:check`; commit**

### Task 10: Completion verification and delivery

**Files:**
- Review all changed files and issue/PR evidence

- [ ] **Step 1: Run native verification**

```bash
swift test --package-path native/parakeet-runtime
pnpm run build-native
pnpm run build:parakeet
```

- [ ] **Step 2: Run application verification**

```bash
pnpm exec vitest run
pnpm run benchmark:recording-quality
pnpm run check
pnpm exec tsc --noEmit
pnpm run changelog:check
pnpm run audit:high
```

- [ ] **Step 3: Run guarded hardware verification with the local-only corpus: sequential per-source v3, word/timing validation, WER/disagreement report, silence precision, peak RSS, and no transcript content in output**

- [ ] **Step 4: Run the packaged or development application workflow: live text, provisional post-stop transcript, Parakeet final replacement, validated status, and analysis input checksum matching the committed canonical transcript**

- [ ] **Step 5: Review every design requirement against direct evidence, update issue #441 content-free, and fix any uncovered gap**

- [ ] **Step 6: Push `codex/441-parakeet-final-transcription`, create the issue-linked PR with verification evidence, and retain the worktree for review**
