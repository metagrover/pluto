# WebRTC AudioProcessing Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide whether Pluto can use the maintained PulseAudio WebRTC AudioProcessing extraction for paired synthetic System/mic chunks without adding production wiring or Pluto-owned DSP.

**Architecture:** The spike is an isolated native test executable. A thin C/Objective-C++ boundary owns only PCM-frame conversion and calls upstream `ProcessReverseStream`, `set_stream_delay_ms`, and `ProcessStream`; upstream owns echo cancellation and delay handling. It consumes generated synthetic PCM only, emits content-free metrics and digests, and fails closed unless every deterministic and frozen gate passes.

**Tech Stack:** Swift Package Manager test harness, Objective-C++, pinned `webrtc-audio-processing` v2.1 revision `846fe90a289f58b7c9303a635142aa2c7caa93e5`, Meson/Ninja arm64 build, TypeScript frozen synthetic AEC gates.

---

### Task 1: Establish the external dependency boundary

**Files:**
- Create: `native/aec-runtime/README.md`
- Create: `scripts/build_webrtc_audio_processing_spike.sh`
- Test: `native/aec-runtime/Tests/AecRuntimeTests/ExternalDependencyTests.swift`

- [ ] **Step 1: Write the failing dependency provenance test**

```swift
func testPinnedWebRTCAudioProcessingRevisionAndArm64ArtifactAreRequired() throws {
    let provenance = try WebRTCAudioProcessingProvenance.load(from: fixtureURL)
    XCTAssertEqual(provenance.revision, "846fe90a289f58b7c9303a635142aa2c7caa93e5")
    XCTAssertEqual(provenance.architecture, "arm64")
    XCTAssertFalse(provenance.artifactDigest.isEmpty)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --package-path native/aec-runtime --filter ExternalDependencyTests`

Expected: FAIL because no provenance loader or artifact exists.

- [ ] **Step 3: Implement only a pinned external build/provenance check**

```sh
git clone --filter=blob:none https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing.git "$source_dir"
git -C "$source_dir" checkout --detach 846fe90a289f58b7c9303a635142aa2c7caa93e5
meson setup "$build_dir" "$source_dir" --buildtype=release
meson compile -C "$build_dir"
```

Record the checked-out revision, target architecture, exported header path, library path, and SHA-256 in content-free provenance JSON. Do not copy upstream source into Pluto and do not add app build/package wiring.

- [ ] **Step 4: Run the dependency test to verify it passes**

Run: `swift test --package-path native/aec-runtime --filter ExternalDependencyTests`

Expected: PASS only with the pinned arm64 artifact and matching digest.

- [ ] **Step 5: Commit**

```bash
git add native/aec-runtime scripts/build_webrtc_audio_processing_spike.sh
git commit -m "test(audio): pin WebRTC AudioProcessing spike dependency (#629)"
```

### Task 2: Prove the upstream APM frame bridge before scoring quality

**Files:**
- Create: `native/aec-runtime/Sources/WebRTCAudioProcessingBridge/WebRTCAudioProcessingBridge.mm`
- Create: `native/aec-runtime/Sources/WebRTCAudioProcessingBridge/include/WebRTCAudioProcessingBridge.h`
- Create: `native/aec-runtime/Tests/AecRuntimeTests/WebRTCAudioProcessingBridgeTests.swift`

- [ ] **Step 1: Write a failing deterministic paired-frame test**

```swift
func testRepeatedReverseDelayCaptureCallsProduceIdenticalResidualDigest() throws {
    let first = try runPairedFixture(kind: .systemOnly, delayMilliseconds: 80)
    let second = try runPairedFixture(kind: .systemOnly, delayMilliseconds: 80)
    XCTAssertEqual(first.residualDigest, second.residualDigest)
    XCTAssertNotEqual(first.residualDigest, first.micDigest)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --package-path native/aec-runtime --filter WebRTCAudioProcessingBridgeTests`

Expected: FAIL because the bridge is absent.

- [ ] **Step 3: Implement the minimal upstream-only bridge**

```objective-c++
processor->ProcessReverseStream(reverse_config, &reverse_frame);
processor->set_stream_delay_ms(delay_ms);
processor->ProcessStream(capture_config, &capture_frame);
```

Accept only 16 kHz mono signed-16 PCM in exact 10 ms frames; reject any other frame size, channel count, sample rate, or non-finite delay. The bridge must not contain filtering, gain, echo subtraction, or fallback DSP.

- [ ] **Step 4: Run the bridge test to verify it passes**

Run: `swift test --package-path native/aec-runtime --filter WebRTCAudioProcessingBridgeTests`

Expected: PASS with the real linked upstream library.

- [ ] **Step 5: Commit**

```bash
git add native/aec-runtime
git commit -m "test(audio): exercise external WebRTC APM frame bridge (#629)"
```

### Task 3: Score delay and drift fixtures with frozen TypeScript gates

**Files:**
- Create: `scripts/run_webrtc_audio_processing_spike.ts`
- Create: `tests/unit/webrtcAudioProcessingSpike.test.ts`
- Modify: `src/services/streamingAec/syntheticFixtures.ts` only if a test proves a frozen-gate bug

- [ ] **Step 1: Write failing no-production gate tests**

```ts
it("requires all frozen synthetic gates and two identical residual digests before reporting a pivot", async () => {
  const report = await runSpike({ fixtureKinds: ["delay", "drift"] });
  expect(report.productionWiringChanged).toBe(false);
  expect(report.decision).toBe("no_backend_selected");
  expect(report.passes).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/webrtcAudioProcessingSpike.test.ts`

Expected: FAIL because the spike runner does not exist.

- [ ] **Step 3: Implement metric extraction and fail-closed scoring**

```ts
const gate = evaluateSyntheticAecGates(metrics);
const passes = report.deterministic && report.rtf <= 0.2 && report.gates.every((entry) => entry.passes);
return { decision: passes ? "webrtc_aec3_selected_for_spike_only" : "no_backend_selected", productionWiringChanged: false, passes };
```

Use generated fixture PCM only, reject malformed bridge output, compare two independent runs byte-for-byte/digest-for-digest, and never read capture journals, meetings, or application audio.

- [ ] **Step 4: Run focused validation**

Run: `pnpm exec vitest run tests/unit/webrtcAudioProcessingSpike.test.ts tests/unit/streamingAecSyntheticFixtures.test.ts && swift test --package-path native/aec-runtime && pnpm exec tsc --noEmit && git diff --check`

Expected: all commands PASS. A failed external build, metric gate, or deterministic check is a valid no-go result and must not be bypassed.

- [ ] **Step 5: Commit**

```bash
git add scripts tests native/aec-runtime docs
git commit -m "test(audio): evaluate external WebRTC APM spike (#629)"
```

### Task 4: Record the decision without production wiring

**Files:**
- Create: `docs/adr/2026-08-16-webrtc-audio-processing-spike.md`
- Create: `docs/changelog/entries/2026-08-16-629-webrtc-aec-spike.md`

- [ ] **Step 1: Write a failing decision-report assertion**

```ts
expect(report.decision).not.toBe("production_enabled");
expect(report.productionWiringChanged).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails before the report exists**

Run: `pnpm exec vitest run tests/unit/webrtcAudioProcessingSpike.test.ts`

Expected: FAIL because the report/decision guard is absent.

- [ ] **Step 3: Document the measured result and exact next action**

Record the pinned revision, artifact digest, test command, gate outcomes, and either `spike-passed; prepare a separately approved production design`, or `no_backend_selected; do not add a fallback`. The ADR must state that the bridge contains no DSP and no production code imports it.

- [ ] **Step 4: Verify docs and branch scope**

Run: `pnpm run changelog:check && git diff --check && git diff --name-only c2b7f7d4..HEAD`

Expected: changelog and whitespace checks PASS; no renderer, Electron capture, finalization, or production package files are changed.

- [ ] **Step 5: Commit**

```bash
git add docs tests
git commit -m "docs(audio): record WebRTC APM spike result (#629)"
```

## Self-review

- Every outcome depends on the real upstream AudioProcessing implementation, never Pluto DSP.
- Every score depends on generated fixtures and frozen TypeScript gates, never fixture metadata or private audio.
- Any inability to build arm64, link the public API, preserve deterministic output, or pass delay/drift remains a no-go rather than an alternate AEC implementation.

