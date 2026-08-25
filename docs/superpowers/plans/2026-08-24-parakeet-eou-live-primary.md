# English Parakeet EOU Live Primary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build English Parakeet EOU as Pluto's only live transcription engine, with causal dual-source PCM, stable committed/tentative text, no MLX transcription fallback, and unchanged sealed-Parakeet canonical finalization.

**Architecture:** Renderer capture stays authoritative and emits 320 ms `Float32` frames per source. Electron owns bounded ordered transport and recording lifecycle; two native `StreamingEouAsrManager` sessions own recognition state and emit fenced committed/tentative updates. The atomic verified Parakeet model bundle gains EOU assets, readiness fails closed, and any runtime EOU failure leaves capture/journaling alive for existing batch Parakeet finalization.

**Tech Stack:** React 18, TypeScript, Electron IPC/JSON-lines, Swift actors, AVFoundation, Core ML, vendored FluidAudio 0.15.5, Vitest, XCTest, Biome.

---

## File map

- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ModelManifest.swift`: add the pinned EOU repository and artifact identity to the atomic model contract.
- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/EouProtocol.swift`: strict EOU request metadata, PCM payload, update, token, and failure types.
- `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`: add EOU methods and keep incompatible fields fail-closed.
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`: download/verify/load EOU 320 ms assets and adapt FluidAudio callbacks.
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetEouSession.swift`: two-source identity, ordering, prefix immutability, lifecycle, and cleanup.
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`: route EOU commands without changing batch or shadow commands.
- `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`: serialize EOU events before one correlated response.
- `electron/transcription/nativeJsonLineProcess.ts`: parse the new request/event surface with bounded content-free failures.
- `electron/transcription/parakeetEouClient.ts`: ordered two-source client with live runtime lease and generation/revision fencing.
- `electron/transcription/parakeetEouMeetingCoordinator.ts`: recording-scoped dual-source lifecycle and terminal failure fan-out.
- `electron/transcription/eouPcmContract.ts`: validate renderer IPC payloads and convert exact Float32 bytes at the native boundary.
- `src/services/liveTranscription/eouPcmChunker.ts`: pure sample-rate-aware 320 ms frame aggregation and short-tail flush.
- `src/services/liveTranscription/eouTranscriptProjection.ts`: immutable committed prefix plus replaceable tentative projection into live segments.
- `src/services/liveTranscription/eouRendererSession.ts`: bounded per-source IPC dispatch, update fencing, and one-way unavailable state.
- `src/components/AudioManager.tsx`: feed causal mic/System samples to EOU and remove recording-time MLX preview/checkpoint work.
- `electron/recordingReadiness.ts`, `src/components/Setup/SetupWizard.tsx`, `electron/main.ts`, `electron/preload.ts`: expose EOU readiness/lifecycle and remove MLX from recording admission.
- `tests/unit/*Eou*.test.ts`, native XCTest targets, and manual causal replay tests: prove contracts and runtime behavior.

### Task 1: Pin EOU assets in the atomic model bundle

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ModelManifest.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ModelArtifactIntegrity.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ModelStoreTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ModelArtifactIntegrityTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioModelInstallerTests.swift`

- [x] **Step 1: Write failing manifest and installer tests**

Add assertions that `ProductionModelManifest.current` contains repository `FluidInference/parakeet-realtime-eou-120m-coreml`, revision `40a23f4c0b333aa17ad8c0f2ea47ec2347f2f355`, EOU artifact digest `4a23a8120f0a5ae8f13bc778e28af239fd00747a406ffb6e98eb06c578437e7f`, and a version different from the prior bundle. Use an injected `RepositoryRevisionChecking` and `EouModelDownloading` fake to assert the installer checks all three revisions, installs only `.parakeetEou320`, and refuses activation when the EOU directory is absent or digest-mismatched.

- [x] **Step 2: Run the native tests and observe failure**

Run: `cd native/parakeet-runtime && swift test --filter 'ModelStoreTests|ModelArtifactIntegrityTests|FluidAudioModelInstallerTests'`

Expected: compilation fails because `eouRepository`, `eouRepositoryRevision`, `eouArtifactSHA256`, and installer seams do not exist.

- [x] **Step 3: Extend the model contract and installer minimally**

Add required `String` fields to `ModelManifest`. Define:

```swift
public enum FluidAudioModelLayout {
    public static let eouDirectoryName = "parakeet-eou-streaming/320ms"
}

protocol RepositoryRevisionChecking: Sendable {
    func require(repository: String, revision: String) async throws
}

protocol EouModelDownloading: Sendable {
    func download320ms(into directory: URL) async throws
}
```

The production downloader calls `ModelHub.download(.parakeetEou320, to: stagingDirectory)` and verifies exactly `decoder.mlmodelc`, `joint_decision.mlmodelc`, `streaming_encoder.mlmodelc`, and `vocab.json`. Verify the whole `parakeet-eou-streaming/320ms` directory against `4a23a8120f0a5ae8f13bc778e28af239fd00747a406ffb6e98eb06c578437e7f` before `ModelStore` writes `active.json`.

- [x] **Step 4: Run focused tests and the existing model suite**

Run: `cd native/parakeet-runtime && swift test --filter 'ModelStoreTests|ModelArtifactIntegrityTests|FluidAudioModelInstallerTests'`

Expected: all selected tests pass; a failed EOU verification leaves no active new bundle.

- [x] **Step 5: Commit the model bundle**

```bash
git add native/parakeet-runtime/Sources/ParakeetRuntimeCore/ModelManifest.swift native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ModelArtifactIntegrity.swift native/parakeet-runtime/Tests
git commit -m "feat: verify Parakeet EOU model bundle"
```

### Task 2: Add the strict native EOU protocol

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/EouProtocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/EouProtocolTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ProtocolTests.swift`

- [x] **Step 1: Write failing decode/encode tests**

Cover `eou_open`, `eou_append`, `eou_finish`, `eou_cancel`, and `eou_reset`. A valid append contains:

```swift
EouAppendMetadata(
    streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
    sampleRate: 48_000, channelCount: 1, frameCount: 15_360,
    audioStartSeconds: 0, audioEndSeconds: 0.32,
    pcmBase64: Data(repeating: 0, count: 15_360 * 4).base64EncodedString()
)
```

Reject zero/unsafe generations or sequences, non-mono input, sample rates outside 8,000...192,000, payloads over two seconds, byte/frame mismatches, invalid base64, NaN/Infinity samples, non-contiguous intervals, append fields on non-append methods, and EOU fields on shadow/batch methods. Decoding errors must not include PCM or recognized content.

- [x] **Step 2: Run tests and observe failure**

Run: `cd native/parakeet-runtime && swift test --filter 'EouProtocolTests|ProtocolTests'`

Expected: compilation fails because EOU types and runtime methods are undefined.

- [x] **Step 3: Implement exact types and validation**

Define `EouRequestMetadata`, `EouPcmFrame`, `EouToken`, `EouUpdate`, `EouStreamFailed`, and `EouRuntimeFailure`. Add runtime methods with raw values `eou_open`, `eou_append`, `eou_finish`, `eou_cancel`, `eou_reset`. Decode PCM through `Data(base64Encoded:)`, bind little-endian Float32 values without unaligned loads, reject non-finite values, and cap decoded bytes at `192_000 * 2 * 4`.

- [x] **Step 4: Run focused tests**

Run: `cd native/parakeet-runtime && swift test --filter 'EouProtocolTests|ProtocolTests'`

Expected: all tests pass and existing schema-v1 batch/shadow fixtures still round-trip byte-for-byte.

- [x] **Step 5: Commit the protocol**

```bash
git add native/parakeet-runtime/Sources/ParakeetRuntimeCore/EouProtocol.swift native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests
git commit -m "feat: add bounded Parakeet EOU protocol"
```

### Task 3: Build isolated native EOU sessions

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetEouSession.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetEouSessionTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioEouAdapterTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetServiceTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/RuntimeJSONLineRouterTests.swift`

- [x] **Step 1: Write failing actor tests with a fake manager**

Define a fake implementing:

```swift
protocol ParakeetEouManaging: Sendable {
    func append(_ buffer: AVAudioPCMBuffer) async throws
    func finish() async throws -> String
    func cancel() async
}
```

Test two simultaneous sources receive different manager identities, exact sequence order, contiguous watermarks, accumulated partial `"hello wor"`, EOU commit `"hello world"`, later partial `"hello world again"`, silence, padded short-tail finish, cancellation, reset to a higher generation, stale callbacks, prefix mutation, manager failure, and shutdown cleanup. A committed prefix mutation must emit one terminal `prefix_mutated` failure and no rewritten update.

- [x] **Step 2: Run tests and observe failure**

Run: `cd native/parakeet-runtime && swift test --filter 'ParakeetEouSessionTests|FluidAudioEouAdapterTests|ParakeetServiceTests|RuntimeJSONLineRouterTests'`

Expected: compilation fails because the EOU session and driver do not exist.

- [x] **Step 3: Implement the session actor and FluidAudio adapter**

Create a session actor with at most one state per source:

```swift
private struct State {
    let streamId: String
    let source: LiveSource
    let generation: Int
    var nextSequence = 1
    var nextRevision = 1
    var audioEndSeconds = 0.0
    var committed = ""
    var latestPartial = ""
    let manager: any ParakeetEouManaging
}
```

Load `StreamingEouAsrManager(chunkSize: .ms320)` from the verified EOU directory. Convert accepted samples to an `AVAudioPCMBuffer` with the declared rate and mono format. Register partial and EOU callbacks before the first append; funnel callbacks back through the owning actor; normalize whitespace only at projection boundaries. `finish()` emits the final state once and destroys the manager.

- [x] **Step 4: Route methods and events**

`ParakeetService.handleEou` requires a prepared active bundle, delegates to the EOU session, and maps finite failures without text. `RuntimeJSONLineRouter` identifies EOU methods, emits all returned `eou_update`/`eou_failed` events through the serialized writer, then emits exactly one response with the original request id.

- [x] **Step 5: Run focused and full native tests**

Run: `cd native/parakeet-runtime && swift test`

Expected: all native tests pass, including the pre-existing 110 tests; no test output contains transcript fixture text from failure paths.

- [x] **Step 6: Commit native EOU inference**

```bash
git add native/parakeet-runtime/Sources native/parakeet-runtime/Tests
git commit -m "feat: run dual-source Parakeet EOU sessions"
```

### Task 4: Add the bounded Electron EOU client and coordinator

**Files:**
- Modify: `electron/transcription/nativeJsonLineProcess.ts`
- Create: `electron/transcription/eouPcmContract.ts`
- Create: `electron/transcription/parakeetEouClient.ts`
- Create: `electron/transcription/parakeetEouMeetingCoordinator.ts`
- Test: `tests/unit/eouPcmContract.test.ts`
- Test: `tests/unit/parakeetEouClient.test.ts`
- Test: `tests/unit/parakeetEouMeetingCoordinator.test.ts`

- [x] **Step 1: Write failing parser and client tests**

Use the existing fake JSON transport. Assert that a `Float32Array(15_360)` at 48 kHz becomes one append with `frameCount: 15360`, `audioEndSeconds: 0.32`, and base64 decoding back to identical bytes. Reject detached/empty/oversized arrays, NaN/Infinity, invalid rates, source reuse, a third stream, sequence gaps, queue overflow, and mismatched response ids.

Assert the client acquires one `live` runtime lease, opens mic and System independently, serializes each source while permitting the other source to progress, fences stale generation/revision events, drains before finish, cancels both streams once on either terminal failure, and releases its lease after finish/cancel.

- [x] **Step 2: Run tests and observe failure**

Run: `pnpm exec vitest run tests/unit/eouPcmContract.test.ts tests/unit/parakeetEouClient.test.ts tests/unit/parakeetEouMeetingCoordinator.test.ts`

Expected: import failures for the three new modules.

- [x] **Step 3: Implement strict transport and client**

Expose these public types:

```ts
export type EouPcmAppend = {
  streamId: string;
  source: 'mic' | 'system';
  generation: number;
  sequence: number;
  sampleRate: number;
  samples: Float32Array;
  audioStartSeconds: number;
  audioEndSeconds: number;
};

export type ParakeetEouUpdate = {
  streamId: string;
  source: 'mic' | 'system';
  generation: number;
  revision: number;
  processedAudioSeconds: number;
  committedText: string;
  tentativeText: string;
  tokens: Array<{ text: string; startSeconds: number; endSeconds: number; committed: boolean }>;
};
```

Use a per-source FIFO capped at four outstanding 320 ms frames. Queue admission increments sequence only after validation. Any terminal error closes the meeting epoch and rejects all outstanding promises with its stable code.

- [x] **Step 4: Implement the meeting coordinator**

`start({meetingId, generation, owner})` opens both sources or rolls both back. `append` requires the active identity and forwards updates only to the owner. `finish` drains mic and System, releases the lease, and ignores later events. `fail` is idempotent, sends one content-free unavailable notification, and cancels both sessions without touching capture APIs.

- [x] **Step 5: Run focused tests**

Run: `pnpm exec vitest run tests/unit/eouPcmContract.test.ts tests/unit/parakeetEouClient.test.ts tests/unit/parakeetEouMeetingCoordinator.test.ts tests/unit/parakeetRuntimeHost.test.ts`

Expected: all tests pass.

- [x] **Step 6: Commit Electron transport**

```bash
git add electron/transcription tests/unit/eouPcmContract.test.ts tests/unit/parakeetEouClient.test.ts tests/unit/parakeetEouMeetingCoordinator.test.ts
git commit -m "feat: coordinate Parakeet EOU live streams"
```

### Task 5: Build renderer PCM chunking and transcript projection

**Files:**
- Create: `src/services/liveTranscription/eouPcmChunker.ts`
- Create: `src/services/liveTranscription/eouTranscriptProjection.ts`
- Create: `src/services/liveTranscription/eouRendererSession.ts`
- Test: `tests/unit/eouPcmChunker.test.ts`
- Test: `tests/unit/eouTranscriptProjection.test.ts`
- Test: `tests/unit/eouRendererSession.test.ts`

- [ ] **Step 1: Write failing chunker tests**

At 48 kHz, three inputs of 4,096 frames must emit exactly after 15,360 accumulated frames, retain 3,072 frames, and report `[0, 0.32]`. At 44.1 kHz, emit 14,112 frames. Preserve every sample exactly across arbitrary split points. `flush()` emits the non-empty tail once with its exact fractional end; reset discards buffered samples and restarts sequence at one.

- [ ] **Step 2: Write failing projection/session tests**

Assert committed `"hello world"` plus tentative `"again"` creates stable `Me` and tentative `Me` segments, a later tentative replacement does not change committed id/text, EOU promotion makes the tentative segment stable, System events interleave by timestamps, duplicate/stale revisions are ignored, a prefix mutation and append rejection switch once to `unavailable`, and no later update re-enables the epoch.

- [ ] **Step 3: Run tests and observe failure**

Run: `pnpm exec vitest run tests/unit/eouPcmChunker.test.ts tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts`

Expected: imports fail for the new modules.

- [ ] **Step 4: Implement pure chunker and projector**

Expose:

```ts
export function createEouPcmChunker(options: {
  source: 'mic' | 'system';
  sampleRate: number;
  advanceMs?: 320;
  onFrame: (frame: EouRendererFrame) => void;
}): { append(samples: Float32Array): void; flush(): void; reset(): void };

export function createEouTranscriptProjection(): {
  apply(update: ParakeetEouUpdate): LiveTranscriptSegment[];
  reset(generation: number): void;
};
```

Use deterministic ids `eou:<generation>:<source>:<committed-revision-or-tentative>`. Split committed/tentative using native token boundaries; never infer canonical status. Sort cross-source rows by start, then source, then revision.

- [ ] **Step 5: Implement bounded renderer dispatch**

`eouRendererSession` owns both chunkers, permits at most four outstanding invokes per source, forwards `PARAKEET_EOU_UPDATE` only for its meeting/generation, and calls `onUnavailable(code)` once on any append/event failure. It stops sending but does not call capture-stop.

- [ ] **Step 6: Run focused tests and lint**

Run: `pnpm exec vitest run tests/unit/eouPcmChunker.test.ts tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts && pnpm exec biome lint src/services/liveTranscription/eouPcmChunker.ts src/services/liveTranscription/eouTranscriptProjection.ts src/services/liveTranscription/eouRendererSession.ts`

Expected: all tests and lint pass.

- [ ] **Step 7: Commit renderer primitives**

```bash
git add src/services/liveTranscription tests/unit/eouPcmChunker.test.ts tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts
git commit -m "feat: project causal Parakeet EOU text"
```

### Task 6: Wire recording IPC and causal audio

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/components/AudioManager.tsx`
- Test: `tests/unit/parakeetEouRecordingIpc.test.ts`
- Test: `tests/unit/audioManagerParakeetEouWiring.test.ts`

- [ ] **Step 1: Write failing architecture and lifecycle tests**

Assert main registers `PARAKEET_EOU_START`, `PARAKEET_EOU_APPEND`, `PARAKEET_EOU_FINISH`, and `PARAKEET_EOU_CANCEL`; binds the coordinator to the active capture owner; rejects another renderer/meeting; cancels on owner destruction; and does not route EOU frames through receipt WAVs.

Read `AudioManager.tsx` as source and assert it creates the EOU renderer session, appends microphone PCM inside `onaudioprocess`, appends decoded System PCM in `NATIVE_AUDIO_CHUNK`, flushes/finishes before canonical finalization, and contains no `LiveTranscriptionQueue`, `resolveLiveChunkModel`, `resolveLiveChunkComputeType`, or `TRANSCRIBE_AUDIO` live invocation.

- [ ] **Step 2: Run tests and observe failure**

Run: `pnpm exec vitest run tests/unit/parakeetEouRecordingIpc.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts`

Expected: IPC channels/session wiring are absent and forbidden live MLX symbols remain.

- [ ] **Step 3: Register main-process lifecycle**

Instantiate one coordinator from `parakeetRuntimeHost`. `START` validates the active capture lease/owner and opens `meetingId.mic` and `meetingId.system`. `APPEND` validates the sender and structured-cloned PCM before native admission. Forward updates on `PARAKEET_EOU_UPDATE` and one failure on `PARAKEET_EOU_UNAVAILABLE`. `FINISH` drains; `CANCEL` and owner destruction cancel idempotently.

- [ ] **Step 4: Replace AudioManager live preview**

After readiness and capture-lease admission, create the EOU session before acquiring mic/System resources. Feed copied microphone samples and decoded System samples into their chunkers in the existing callbacks. Update `onLiveTranscript`, `onInterimTranscript`, responsiveness, and live integrity from the projector. On unavailable, preserve current rows, mark the live surface unavailable, and continue recording.

Remove the recording-time five-second MLX queue and chunk checkpoint transcription. Preserve raw receipt journaling, activity evidence, stop sealing, batch Parakeet finalization, speaker attribution inputs that are not transcription, and analysis sequencing.

- [ ] **Step 5: Make stop and error cleanup exact**

Normal stop: detach callbacks, flush chunkers, await EOU finish, then seal/finalize. Start failure: cancel EOU and release capture lease before returning. Mid-record failure: do not call stop. Renderer unload/unmount: cancel EOU and execute existing capture-owner cleanup. Fence all async continuations by `meetingId` plus generation.

- [ ] **Step 6: Run focused recording tests**

Run: `pnpm exec vitest run tests/unit/parakeetEouRecordingIpc.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/captureSessionGuard.test.ts tests/unit/recordingFinalization.test.ts tests/unit/liveTranscriptResponsivenessWiring.test.ts`

Expected: all tests pass and the architecture test proves the active recording file no longer imports the MLX live queue.

- [ ] **Step 7: Commit recording wiring**

```bash
git add electron/main.ts electron/preload.ts src/components/AudioManager.tsx tests/unit/parakeetEouRecordingIpc.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts
git commit -m "feat: make Parakeet EOU the live recording engine"
```

### Task 7: Fail recording readiness closed on EOU, not MLX

**Files:**
- Modify: `electron/recordingReadiness.ts`
- Modify: `electron/main.ts`
- Modify: `src/components/Setup/SetupWizard.tsx`
- Modify: `src/utils/transcriptionSettings.ts`
- Modify: `src/services/transcription/policy.ts`
- Test: `tests/unit/recordingReadiness.test.ts`
- Test: `tests/unit/SetupWizard.dom.test.tsx`
- Test: `tests/unit/transcriptionSettings.test.ts`
- Test: `tests/unit/transcriptionSettingsSurface.test.ts`
- Test: `tests/unit/transcriptionArchitectureCleanup.test.ts`

- [ ] **Step 1: Change tests first**

Replace `mlxAvailable` with `parakeetEouReady`. A prepared final client without EOU capability must return blocker `parakeet_eou_unavailable`. Preparing readiness calls Parakeet prepare/capability exactly once and never calls `mlxPreview.health`, `start`, `transcribe`, or `prepareDiarizationModels`. Setup displays an English Parakeet live requirement. Settings resolve one English policy and expose no live backend/model/language selector.

Add a source-boundary test that active recording/readiness/final transcription modules do not import `mlxPreviewClient`, while allowing MLX files to remain elsewhere for the later deletion phase.

- [ ] **Step 2: Run tests and observe failure**

Run: `pnpm exec vitest run tests/unit/recordingReadiness.test.ts tests/unit/SetupWizard.dom.test.tsx tests/unit/transcriptionSettings.test.ts tests/unit/transcriptionSettingsSurface.test.ts tests/unit/transcriptionArchitectureCleanup.test.ts`

Expected: old MLX readiness expectations and `mlx_preview` settings fail.

- [ ] **Step 3: Implement English EOU readiness**

Have Parakeet `prepare()` return `{ ready: true, engine: 'parakeet_coreml', liveEngine: 'parakeet_eou_320ms', modelVersion }` only after the atomic bundle verifies. `getRecordingReadinessStatus` consumes that capability instead of checking directory non-emptiness. Remove all MLX calls from readiness. Preserve AudioCap and permission blockers unchanged.

Collapse transcription settings to English-only product intent while retaining tolerant parsing for legacy persisted values. Runtime resolution always returns `language: 'en'`, live engine `parakeet_eou_320ms`, and final engine `parakeet_coreml`.

- [ ] **Step 4: Run focused tests and lint**

Run: `pnpm exec vitest run tests/unit/recordingReadiness.test.ts tests/unit/SetupWizard.dom.test.tsx tests/unit/transcriptionSettings.test.ts tests/unit/transcriptionSettingsSurface.test.ts tests/unit/transcriptionArchitectureCleanup.test.ts && pnpm exec biome lint electron/recordingReadiness.ts src/components/Setup/SetupWizard.tsx src/utils/transcriptionSettings.ts src/services/transcription/policy.ts`

Expected: all tests and lint pass.

- [ ] **Step 5: Commit readiness policy**

```bash
git add electron/recordingReadiness.ts electron/main.ts src/components/Setup/SetupWizard.tsx src/utils/transcriptionSettings.ts src/services/transcription/policy.ts tests/unit
git commit -m "feat: require English Parakeet EOU readiness"
```

### Task 8: Prove causal replay and failure isolation

**Files:**
- Create: `tests/manual/parakeetEouCausalReplay.test.ts`
- Create: `scripts/run_private_parakeet_eou_replay.ts`
- Create: `scripts/validate_private_parakeet_eou_manifest.ts`
- Modify: `package.json`
- Test: `tests/unit/privateParakeetEouManifest.test.ts`
- Test: `tests/manual/parakeetApplicationWorkflow.test.ts`

- [ ] **Step 1: Write failing private-manifest tests**

Require an ignored manifest containing absolute mic/System WAV paths, SHA-256 digests, expected duration, and no transcript content. Validate both files are regular, within an explicitly approved private root, mono-convertible, and unchanged before replay. Reject symlinks, `/`, home/workspace roots, missing sources, bad digests, and public fixture paths.

- [ ] **Step 2: Run and observe failure**

Run: `pnpm exec vitest run tests/unit/privateParakeetEouManifest.test.ts`

Expected: replay validator does not exist.

- [ ] **Step 3: Implement real-time-order replay**

Decode each private WAV to Float32, chunk it through the production 320 ms chunker, interleave sources by audio watermark, and pace appends using an injectable clock. The real mode uses the packaged native runtime and verified model bundle. Report content-free first-partial, first-EOU, p50/p95 update latency, maximum queue depth, source coverage, tail coverage, native RSS, thermal states, cancellations, and failures. Never print paths, text, PCM, tokens, meeting ids, or file hashes.

- [ ] **Step 4: Add runtime failure workflow**

Extend the application workflow fake so a native EOU exit after committed text leaves `NATIVE_AUDIO_STOP`, journal seal, batch Parakeet finalization, and persisted reload reachable. Assert no MLX IPC or process start occurs and the committed preview is not saved as canonical.

- [ ] **Step 5: Run deterministic replay tests**

Run: `pnpm exec vitest run tests/unit/privateParakeetEouManifest.test.ts tests/manual/parakeetApplicationWorkflow.test.ts`

Expected: deterministic fake-clock and failure-isolation cases pass.

- [ ] **Step 6: Run the private causal replay**

Run: `RUN_PARAKEET_EOU_CAUSAL_REPLAY=1 PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST="$PWD/.private/parakeet-eou/manifest.json" pnpm exec vitest run tests/manual/parakeetEouCausalReplay.test.ts`

Expected: both sources emit ordered updates, tail coverage reaches each input duration, queue depth stays within four, the runtime exits cleanly, and the report contains no private content.

- [ ] **Step 7: Commit replay tooling**

```bash
git add tests/manual/parakeetEouCausalReplay.test.ts scripts/run_private_parakeet_eou_replay.ts scripts/validate_private_parakeet_eou_manifest.ts tests/unit/privateParakeetEouManifest.test.ts tests/manual/parakeetApplicationWorkflow.test.ts package.json
git commit -m "test: verify causal Parakeet EOU replay"
```

### Task 9: Package, document, and verify the product path

**Files:**
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Create: `docs/changelog/entries/2026-08-24-663-parakeet-eou-live-primary.md`
- Modify: `docs/superpowers/plans/2026-08-24-parakeet-eou-live-primary.md`

- [ ] **Step 1: Write the changelog fragment**

Record:

```markdown
# English Parakeet EOU live transcription

## Changed
- Live microphone and System text now comes from independent local Parakeet EOU sessions with 320 ms causal audio advances.
- Recording readiness requires the verified English EOU model; Pluto never switches live transcription to MLX.

## Why
- True streaming reduces preview delay and one explicit engine makes failures observable instead of hiding them behind fallback behavior.

## Replaced
- Replaces five-second MLX Whisper live preview and MLX recording-readiness checks. Sealed Parakeet finalization remains canonical.

## Notes
- MLX source remains temporarily packaged for separately reviewed removal, but recording transcription cannot invoke it.
```

- [ ] **Step 2: Verify clean packaging inputs**

Build the native runtime and inspect packaged resources. Confirm the binary contains EOU protocol strings, the installer metadata contains the pinned EOU revision/digest, no model weights are bundled, and AudioCap/runtime executable permissions are preserved.

Run: `pnpm run build-native && pnpm exec electron-builder --dir`

Expected: both commands succeed; packaged app contains `parakeet-runtime` and no `*.mlmodelc` EOU weights.

- [ ] **Step 3: Run the complete automated suite**

Run: `pnpm exec vitest run && (cd native/parakeet-runtime && swift test) && pnpm exec biome lint electron/recordingReadiness.ts electron/transcription src/components/AudioManager.tsx src/components/Setup/SetupWizard.tsx src/services/liveTranscription src/services/transcription/policy.ts src/utils/transcriptionSettings.ts tests/unit && git diff --check`

Expected: all TypeScript and Swift tests pass; focused Biome lint and diff check pass. Leave the known vendored FluidAudio `english.json` formatting mismatch untouched if whole-repo lint reports it.

- [ ] **Step 4: Run a real Electron recording smoke**

Start `pnpm run dev`, wait for `/health`, open the recording UI, and record audible English from mic and System. Verify visible committed/tentative rows update during speech, stop remains responsive, final processing uses Parakeet, and reopening the meeting shows the persisted canonical transcript. Terminate the native runtime during a second recording and verify capture continues, live becomes unavailable, stop seals, and no MLX process starts.

Expected: both happy path and failure path satisfy issue #663 without private content in logs.

- [ ] **Step 5: Update issue traceability and check off the plan**

Comment on issue #663 with commit ids, exact automated counts, causal replay metrics, packaging result, and Electron smoke evidence. Mark every completed checkbox in this plan; leave any unverified real-runtime gate unchecked and report it honestly.

- [ ] **Step 6: Commit shipping evidence**

```bash
git add docs/changelog/entries/2026-08-24-663-parakeet-eou-live-primary.md docs/superpowers/plans/2026-08-24-parakeet-eou-live-primary.md package.json electron-builder.yml
git commit -m "docs: record Parakeet EOU live promotion"
```

- [ ] **Step 7: Finish the branch**

Use `.agent/skills/finishing-a-development-branch/SKILL.md`. Re-run final verification after any hook formatting or integration, preserve the dirty root checkout, and do not push the ahead local `master` without explicit authorization.
