# Diarization-First Attribution Restoration Implementation Plan

> **For agentic workers:** Implement each task in order with Pluto's test-driven-development skill. Do not write production logic before the named failing test demonstrates the missing behavior.

**Goal:** Restore trustworthy local speaker attribution after the Parakeet cutover and make the same fail-closed pipeline available as an explicit historical retry.

**Architecture:** Add a sealed-file `speaker_evidence` request to the existing Swift runtime. FluidAudio performs anonymous offline diarization on the mixed WAV while a native bounded analyzer produces aligned microphone/system RMS windows. Electron exposes this through the existing final runtime lease. TypeScript maps anonymous clusters from acoustic evidence, aligns transcript segments, applies production acceptance, and only then commits canonical speaker labels and starts downstream work.

**Tech stack:** Swift 6, FluidAudio/Core ML, AVFoundation/Accelerate, TypeScript, Electron IPC, React, Vitest, Swift Testing/XCTest, Biome.

---

## File map

- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`: add strict request/response speaker-evidence types.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeCore/RuntimeResponse.swift`: encode speaker-evidence success and typed failures.
- Create `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`: driver protocols, evidence service, RMS analyzer, and FluidAudio adapter.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`: pinned diarization manifest and verified preparation.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`: path-approved speaker-evidence handling.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`: route and cancel the new operation.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntime/main.swift`: construct the production evidence driver.
- Modify `electron/transcription/parakeetFinalClient.ts`: request and validate speaker evidence under the final runtime lease.
- Modify `electron/main.ts`: expose the bounded IPC handler.
- Create `src/services/finalTranscription/applySpeakerEvidence.ts`: align segments, apply acoustic mapping, enforce acceptance, and build stored provenance.
- Modify `src/services/finalTranscription/runFinalTranscription.ts`: add the attribution stage before canonical commit.
- Modify `src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts`: pass all sealed paths and persist accepted attribution only.
- Modify `src/services/retryMeetingTranscriptValidation.ts`: route eligible historical attribution retries through the same final worker and compare-and-save contract.
- Modify `src/utils/transcriptTrustState.ts` and `src/components/features/meetingFailurePresentation.ts`: explain retryable attribution verification failures.
- Add focused native and TypeScript tests named below.
- Create `docs/changelog/entries/2026-09-02-725-diarization-first-attribution.md`.

### Task 1: Define the strict native speaker-evidence protocol

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/RuntimeResponse.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ProtocolTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/LiveProtocolTests.swift`

- [ ] Add failing round-trip tests for `speaker_evidence` with required `mixedAudioPath`, `micAudioPath`, and `systemAudioPath`, plus typed anonymous turns, aligned energy windows, provenance, and timings in the response.
- [ ] Add failing rejection tests for each missing path and for speaker-evidence fields supplied to any other method.
- [ ] Run `swift test --package-path native/parakeet-runtime --filter ProtocolTests` and confirm RED.
- [ ] Implement schema-v1 types and method-specific key compatibility. Keep ordinary transcript text, embeddings, and names out of the protocol.
- [ ] Re-run the protocol tests and confirm GREEN.

### Task 2: Build deterministic bounded source-energy analysis

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/SpeakerEnergyAnalyzerTests.swift`

- [ ] Add failing tests that generate small synthetic mono WAV fixtures and assert 100 ms aligned RMS windows for mic-only speech, system-only speech, silence, unequal lengths, and cancellation.
- [ ] Assert the analyzer never emits NaN/negative RMS, windows are monotonic and bounded by the longest input, and memory use is independent of whole-meeting sample count by exercising its chunk-reader abstraction.
- [ ] Run `swift test --package-path native/parakeet-runtime --filter SpeakerEnergyAnalyzerTests` and confirm RED.
- [ ] Implement an AVFoundation/Accelerate-backed streaming analyzer with injectable sample readers. Downmix deterministically and reject unsupported/corrupt input with `audioAnalysisFailed`.
- [ ] Re-run the focused tests and confirm GREEN.

### Task 3: Add pinned FluidAudio offline diarization

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ProductionModelManifestTests.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`

- [ ] Resolve the current `FluidInference/speaker-diarization-coreml` immutable commit from the primary repository API and compute the required installed-artifact digests with Pluto's canonical model-integrity function. Do not use `main` or placeholder hashes.
- [ ] Add failing manifest tests requiring a full commit revision and nonempty digests for `Segmentation.mlmodelc`, `FBank.mlmodelc`, `Embedding.mlmodelc`, `PldaRho.mlmodelc`, and `plda-parameters.json`.
- [ ] Add failing adapter tests with injected model loader/manager doubles for preparation, anonymous turn conversion, empty-result rejection, cancellation, and absence of embeddings from the public result.
- [ ] Run the two focused Swift suites and confirm RED.
- [ ] Implement `ProductionDiarizationManifest`, staged verified preparation, `ModelRegistry.setPinnedRevision`, and the disk-backed `OfflineDiarizerManager.process(URL)` adapter.
- [ ] Re-run focused tests and confirm GREEN. A normal unit-test run must not download production models.

### Task 4: Route speaker evidence through the native service and Electron lease

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntime/main.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetServiceTests.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/RuntimeJSONLineRouterTests.swift`
- Modify: `electron/transcription/parakeetFinalClient.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/parakeetFinalClient.test.ts`

- [ ] Add failing service tests proving all three files are approved below `audioRoot`, an out-of-root or symlink escape returns `pathNotAllowed`, and the driver receives only approved URLs.
- [ ] Add failing coordinator tests proving cancel/shutdown suppress a late result.
- [ ] Add failing Electron client tests for exact request shape, strict response validation, final-lease ownership, abort propagation, runtime failure mapping, and content-free diagnostics.
- [ ] Run the focused Swift and Vitest suites and confirm RED.
- [ ] Implement native routing and an Electron `TRANSCRIPTION_SPEAKER_EVIDENCE` handler backed by the existing final runtime host. Do not add a second process or bypass lease admission.
- [ ] Re-run focused tests and confirm GREEN.

### Task 5: Apply acoustic attribution before canonical commit

**Files:**
- Create: `src/services/finalTranscription/applySpeakerEvidence.ts`
- Create: `tests/unit/applySpeakerEvidence.test.ts`
- Modify: `src/services/finalTranscription/runFinalTranscription.ts`
- Modify: `tests/unit/runFinalTranscription.test.ts`
- Modify: `src/services/productionSpeakerAttributionAcceptance.ts` only if a pure adapter is needed; do not weaken thresholds.

- [ ] Add failing pure tests for word/segment-to-turn alignment, overlap tie-breaking, gaps becoming `Unknown`, exactly one possible `Me` cluster, bounded short-interruption injection, and accepted stored provenance.
- [ ] Add failing safety tests proving system-correlated evidence over a proposed local cluster rejects the candidate and empty/ambiguous evidence cannot validate.
- [ ] Add failing orchestration tests proving stage order is `mic ASR -> system ASR -> speaker evidence -> acceptance -> commit -> downstream`, and any attribution failure calls `markNeedsAttention` without `commitCanonical` or `startAnalysis`.
- [ ] Run `pnpm exec vitest run tests/unit/applySpeakerEvidence.test.ts tests/unit/acousticSpeakerAttribution.test.ts tests/unit/productionSpeakerAttributionAcceptance.test.ts tests/unit/runFinalTranscription.test.ts` and confirm RED.
- [ ] Implement the pure attribution boundary using existing `deriveAttributionEvidence`, `mapDiarizationFromAcousticEvidence`, `injectLocalEvidenceWindows`, and production acceptance. Preserve tuning constants and uncertainty.
- [ ] Re-run focused tests and confirm GREEN.

### Task 6: Persist only accepted attribution and make retries safe

**Files:**
- Modify: `src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts`
- Modify: `tests/unit/runPersistedMeetingFinalTranscription.test.ts`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `tests/unit/retryMeetingTranscriptValidation.test.ts`
- Modify: `electron/commitmentIdentity.ts` if downstream gating reads attribution independently.

- [ ] Add failing persisted-worker tests requiring `mixedAudioPath`, invoking native speaker evidence, storing `source: offline_diarization_acoustic_v1`, `diarization: true`, mapping confidence/provenance, and starting downstream only after compare-and-save succeeds.
- [ ] Add failing tests proving missing mix, rejected attribution, unavailable model, and confidence-zero fallback preserve the visible provisional transcript as `needs_attention` and block downstream work.
- [ ] Add retry tests for channel-fallback, confidence-zero, missing, and rejected attribution; assert already accepted meetings do not re-run solely for attribution.
- [ ] Add stale-result tests for capture generation, prior transcript digest, source paths, and lease owner changing before commit.
- [ ] Run `pnpm exec vitest run tests/unit/runPersistedMeetingFinalTranscription.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/transcriptTrustState.test.ts` and confirm RED.
- [ ] Reuse the current final worker for eligible retry and extend the existing compare-and-save claim/commit metadata rather than adding a direct DB rewrite.
- [ ] Re-run focused tests and confirm GREEN.

### Task 7: Explain attribution recovery without increasing meeting-view density

**Files:**
- Modify: `src/utils/transcriptTrustState.ts`
- Modify: `src/components/features/meetingFailurePresentation.ts`
- Modify: `tests/unit/transcriptTrustState.test.ts`
- Modify: `tests/unit/meetingFailurePresentation.test.ts`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [ ] Add failing tests for a dedicated attribution-verification failure presentation: concise explanation, `Retry transcription`, no model internals, and no extra persistent control when attribution is accepted.
- [ ] Run the three focused tests and confirm RED.
- [ ] Map the content-free failure code into the existing recovery panel and retry action. Keep the existing progressive-disclosure treatment.
- [ ] Re-run focused tests and confirm GREEN.

### Task 8: Package, replay, and record the restoration

**Files:**
- Modify: `scripts/verify_packaged_runtime.mjs` if needed to assert speaker-evidence support.
- Modify: `scripts/run_local_speaker_attribution_benchmark.ts` only to consume the production native adapter without logging private content.
- Create: `docs/changelog/entries/2026-09-02-725-diarization-first-attribution.md`

- [ ] Add the issue-scoped changelog fragment describing native diarization, fail-closed downstream gating, and explicit historical retry.
- [ ] Run `swift test --package-path native/parakeet-runtime`.
- [ ] Run all attribution/finalization/retry Vitest suites from Tasks 4-7.
- [ ] Run `pnpm exec biome check` on every changed TypeScript/Markdown file, `pnpm exec tsc --noEmit`, `pnpm run changelog:check`, and `pnpm run test`.
- [ ] Run `pnpm run build-native`, restore the Electron-compatible SQLite ABI with `pnpm run ensure:sqlite-abi`, run the Electron build, package the app, and run `node scripts/verify_packaged_runtime.mjs` against the package.
- [ ] Run a read-only, content-free private replay over the reported latest meeting and a bounded historical cohort. Record only aggregate false-`Me`, missed-`Me`, unknown, confidence, runtime, and acceptance measurements outside Git; never print transcript text or source paths.
- [ ] If a usable local Pluto runtime is available, verify the finalization stage and retry explanation in the rendered app. Otherwise state that automated DOM coverage passed and rendered evidence was unavailable.
- [ ] Inspect `git diff origin/master...HEAD` for scope and secrets, update #725 with content-free acceptance evidence, push `codex/725-diarization-attribution`, and open a PR that closes #725. Do not claim completion until the remote branch SHA and packaged runtime are verified.
