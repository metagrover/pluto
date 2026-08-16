# Parakeet Live Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped, privacy-safe Parakeet TDT v3 pseudo-streaming adapter and automated causal replay that decides whether it can replace MLX live transcription and routine whole-session final ASR.

**Architecture:** Extend the existing pinned native process with additive live-stream commands and typed asynchronous events, adapt FluidAudio's prior-tentative promotion into a Pluto-owned monotonic stable-prefix contract, and expose it through a bounded Electron client. A local-only replay feeds identical causally available mic/System audio to production MLX and Parakeet, then gates latency, continuity, memory, thermal, gap repair, and batch consistency without treating batch output as ground truth.

**Tech Stack:** Swift 6, FluidAudio 0.15.5 / Parakeet TDT v3 Core ML, TypeScript, Electron IPC, JSON-lines, Vitest 4, XCTest, SQLite, FFmpeg, macOS process/thermal sampling.

## Execution status (superseded by #630 primary-flow plan)

Tasks 1–5 and Task 7's guarded native-runtime test are complete and committed on
`codex/630-parakeet-live`. The private replay runner is implemented, but it is
not promotion-approved and does not change user-visible live transcription.

The remaining replay-semantic work is tracked as Task 4A in
`2026-08-15-parakeet-primary-execution.md`:

- bucket native events by stream, source, and generation;
- derive stability from cumulative committed-preview state rather than tentative
  event text;
- make first activity causal, join MLX evidence correctly, and score real
  recognizer seams;
- fail closed on spawn, exit, or cleanup uncertainty; bound repair words to
  their requested window; reconcile with the canonical transcript; and prove
  bounded retention for a 90-minute synthetic stream.

The primary-flow plan retains MLX fallback and the canonical full final pass
until its separate AEC, rollout, and evidence gates are complete.

---

## File map

- Create `src/services/liveTranscription/stablePrefix.ts`: pure tentative/committed-preview state reducer.
- Create `src/services/liveTranscription/contracts.ts`: provider-neutral live stream event and snapshot types.
- Create `tests/unit/liveTranscriptionStablePrefix.test.ts`: reducer invariants.
- Create `native/parakeet-runtime/Sources/ParakeetRuntimeCore/LiveProtocol.swift`: live request/event wire types.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`: additive live methods and response/event envelope discrimination.
- Create `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/LiveProtocolTests.swift`: wire compatibility and finite errors.
- Create `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetLiveSession.swift`: stream registry, ordering, generation, lifecycle, and FluidAudio adapter seam.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`: route live methods without changing batch behavior.
- Modify `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`: reuse verified loaded models and suppress content-bearing dependency logs.
- Create `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetLiveSessionTests.swift`: registry and lifecycle tests with a fake manager.
- Modify `electron/transcription/nativeJsonLineProcess.ts`: typed response/event interleaving.
- Create `electron/transcription/parakeetLiveClient.ts`: bounded live client and generation fencing.
- Create `tests/unit/parakeetLiveClient.test.ts`: process/client behavior.
- Create `src/services/liveTranscriptionReplayMetrics.ts`: causal metrics, percentiles, confidence bounds, and sanitizer.
- Create `src/services/liveTranscriptionReplay.ts`: virtual scheduler and engine-neutral replay seam.
- Create `tests/unit/liveTranscriptionReplayMetrics.test.ts`: deterministic metrics and report privacy.
- Create `scripts/run_private_parakeet_live_replay.ts`: local-only corpus selection and execution.
- Create `scripts/validate_private_parakeet_live_manifest.ts`: private manifest validator.
- Create `tests/unit/privateParakeetLiveManifest.test.ts`: content/path rejection.
- Modify `package.json`: benchmark and validator commands.
- Modify `docs/adr/2026-08-15-parakeet-final-transcription.md`: record pseudo-streaming feasibility result only after measurement.
- Modify `docs/dev.md`: local commands and content-free constraints.
- Create `docs/changelog/entries/2026-08-15-630-parakeet-live-feasibility.md`: shipped feasibility seam and decision.

### Task 1: Stable-prefix contract

**Files:**
- Create: `src/services/liveTranscription/contracts.ts`
- Create: `src/services/liveTranscription/stablePrefix.ts`
- Test: `tests/unit/liveTranscriptionStablePrefix.test.ts`

- [ ] **Step 1: Write the failing reducer tests**

```ts
import { describe, expect, it } from 'vitest';
import { reduceLiveStreamUpdate } from '../../src/services/liveTranscription/stablePrefix.ts';

describe('reduceLiveStreamUpdate', () => {
  it('promotes the prior tentative tail when FluidAudio qualifies the next update', () => {
    const first = reduceLiveStreamUpdate(undefined, {
      source: 'system', generation: 1, revision: 1,
      text: 'alpha beta', qualifiesPriorTentative: false,
      confidence: 0.7, audioEndSeconds: 4,
    });
    const second = reduceLiveStreamUpdate(first, {
      source: 'system', generation: 1, revision: 2,
      text: 'gamma', qualifiesPriorTentative: true,
      confidence: 0.9, audioEndSeconds: 6,
    });
    expect(second.committedPreviewText).toBe('alpha beta');
    expect(second.tentativeText).toBe('gamma');
  });

  it('ignores stale generations and revisions without mutating committed text', () => {
    const current = {
      source: 'mic' as const, generation: 2, revision: 4,
      committedPreviewText: 'stable', tentativeText: 'tail', audioEndSeconds: 8,
    };
    expect(reduceLiveStreamUpdate(current, {
      source: 'mic', generation: 1, revision: 99, text: 'stale',
      qualifiesPriorTentative: true, confidence: 1, audioEndSeconds: 9,
    })).toEqual(current);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run tests/unit/liveTranscriptionStablePrefix.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the provider-neutral types and minimal reducer**

```ts
export type LiveSource = 'mic' | 'system';

export type LiveStreamUpdate = {
  source: LiveSource;
  generation: number;
  revision: number;
  text: string;
  qualifiesPriorTentative: boolean;
  confidence: number;
  audioEndSeconds: number;
};

export type LiveStreamSnapshot = {
  source: LiveSource;
  generation: number;
  revision: number;
  committedPreviewText: string;
  tentativeText: string;
  audioEndSeconds: number;
};
```

Implement `reduceLiveStreamUpdate` so a qualifying update appends only the prior tentative text to the committed-preview prefix, installs current text as tentative, ignores stale identity, and never calls committed-preview text validated or canonical.

- [ ] **Step 4: Add Unicode, punctuation, empty-tail, dual-source, and stable-ID cases**

Run: `pnpm exec vitest run tests/unit/liveTranscriptionStablePrefix.test.ts`  
Expected: PASS with no committed-prefix edit in any case.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscription tests/unit/liveTranscriptionStablePrefix.test.ts
git commit -m "feat(transcription): define live stable-prefix contract (#630)"
```

### Task 2: Additive native live protocol

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/LiveProtocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/LiveProtocolTests.swift`

- [ ] **Step 1: Write failing JSON compatibility tests**

```swift
func testDecodesStrictLiveAppendIdentity() throws {
    let data = Data(#"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"system","generation":2,"sequence":4,"audioPath":"/approved/4.wav","chunkStartSeconds":20,"chunkEndSeconds":25}"#.utf8)
    let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)
    XCTAssertEqual(request.method, .streamAppend)
    XCTAssertEqual(request.live?.sequence, 4)
}

func testEventEnvelopeIsNotAResponseEnvelope() throws {
    let event = RuntimeEvent.streamUpdate(.init(
        streamId: "s", source: .system, generation: 2, eventSequence: 3,
        priorTentativeQualified: true, text: "synthetic", confidence: 0.9,
        audioEndSeconds: 25
    ))
    XCTAssertEqual(event.kind, .event)
}
```

- [ ] **Step 2: Run XCTest and verify RED**

Run: `swift test --package-path native/parakeet-runtime --filter LiveProtocolTests`  
Expected: FAIL because live protocol types and methods do not exist.

- [ ] **Step 3: Implement strict additive request/event types**

Define `stream_open`, `stream_append`, `stream_flush`, `stream_cancel`, and `stream_reset`. Require `streamId`, source, positive generation, finite non-negative boundaries, and strict sequence for append. Define `stream_update`, `stream_degraded`, and `stream_failed` event unions with finite error enums. Retain schema version 1 and current batch request decoding.

- [ ] **Step 4: Add rejection and privacy tests**

Cover missing identity, invalid source, negative/NaN boundaries, arbitrary error strings, unknown event kind, and encoded events containing only the intentionally transported transcript text plus allowlisted metadata. Logs and diagnostic payloads must not echo text.

Run: `swift test --package-path native/parakeet-runtime --filter LiveProtocolTests`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/parakeet-runtime/Sources/ParakeetRuntimeCore native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/LiveProtocolTests.swift
git commit -m "feat(transcription): define Parakeet live protocol (#630)"
```

### Task 3: Native live session registry and FluidAudio adapter

**Files:**
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetLiveSession.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetLiveSessionTests.swift`

- [ ] **Step 1: Write failing registry tests against a fake live manager**

```swift
func testRejectsGapInsteadOfCompressingTimeline() async throws {
    let session = ParakeetLiveSession(driver: FakeLiveDriver())
    _ = try await session.open(streamId: "s", source: .system, generation: 1)
    _ = try await session.append(streamId: "s", generation: 1, sequence: 0, audioURL: approved0)
    await XCTAssertThrowsAsyncError(
        try await session.append(streamId: "s", generation: 1, sequence: 2, audioURL: approved2)
    ) { XCTAssertEqual($0 as? LiveRuntimeFailure, .sequenceGap) }
}

func testFlushDestroysOneShotManagerAndProcessesTail() async throws {
    let driver = FakeLiveDriver(finalText: "tail")
    let session = ParakeetLiveSession(driver: driver)
    _ = try await session.open(streamId: "s", source: .mic, generation: 1)
    let result = try await session.flush(streamId: "s", generation: 1)
    XCTAssertEqual(result.finalPreview, "tail")
    XCTAssertNil(await session.state(streamId: "s"))
}
```

- [ ] **Step 2: Run XCTest and verify RED**

Run: `swift test --package-path native/parakeet-runtime --filter ParakeetLiveSessionTests`  
Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement registry identity, bounded admission, and lifecycle**

Use a Pluto-owned actor with at most two active source streams, a small bounded FIFO per stream, strict expected sequence, and a generation fence. Duplicate append succeeds only when checksum and boundaries match. Flush/cancel removes the one-shot manager. Reset is cancel/remove/recreate, never `SlidingWindowAsrManager.reset()` after finish.

- [ ] **Step 4: Implement verified-model FluidAudio driver**

Load one `AsrModels` bundle from `activeModelURL`; do not call FluidAudio default download/cache APIs. Create distinct mic/System `SlidingWindowAsrManager` actors using the shared verified bundle. Subscribe to updates before append. Adapt `isConfirmed` into `priorTentativeQualified`. Start with `vocabularyMode: final_only` until the CTC tokenizer directory can be injected from Pluto's verified bundle. Suppress content-bearing FluidAudio debug logs.

Evaluate two configs through an injected factory:

```swift
let pinnedDefault = SlidingWindowAsrConfig.default
let lowLatencyCandidate = SlidingWindowAsrConfig(
    chunkSeconds: 2.0,
    hypothesisChunkSeconds: 2.0,
    leftContextSeconds: 2.0,
    rightContextSeconds: 2.0,
    minContextForConfirmation: 10.0,
    confirmationThreshold: 0.80,
    tdtConfig: TdtConfig(blankId: AsrModelVersion.v3.blankId)
)
```

- [ ] **Step 5: Add update, partial failure, cancel, reset, and shutdown tests**

Partial window failure must emit degradation and leave an explicit coverage gap. Cancellation emits no late update. Shared models must not share decoder state. Approved-path policy applies to every append.

Run: `swift test --package-path native/parakeet-runtime --filter ParakeetLiveSessionTests`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/parakeet-runtime/Sources/ParakeetRuntimeEngine native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetLiveSessionTests.swift
git commit -m "feat(transcription): add bounded Parakeet live sessions (#630)"
```

### Task 4: Correlated Electron live client

**Files:**
- Modify: `electron/transcription/nativeJsonLineProcess.ts`
- Create: `electron/transcription/parakeetLiveClient.ts`
- Test: `tests/unit/parakeetLiveClient.test.ts`

- [ ] **Step 1: Write failing response/event interleaving tests**

```ts
it('publishes valid events without failing the pending response', async () => {
  const process = makeFakeProcess();
  const client = new ParakeetLiveClient({ process, maxQueuedAppends: 2 });
  const updates: unknown[] = [];
  client.onUpdate((update) => updates.push(update));
  const open = client.open({ streamId: 's', source: 'system', generation: 1 });
  process.emitLine(JSON.stringify({ schemaVersion: 1, kind: 'event', event: 'stream_update', streamId: 's', source: 'system', generation: 1, eventSequence: 1, priorTentativeQualified: false, text: 'synthetic', confidence: 0.7, audioEndSeconds: 4 }));
  process.respondNext({ ok: true });
  await expect(open).resolves.toBeDefined();
  expect(updates).toHaveLength(1);
});
```

- [ ] **Step 2: Run Vitest and verify RED**

Run: `pnpm exec vitest run tests/unit/parakeetLiveClient.test.ts`  
Expected: FAIL because unsolicited event envelopes are rejected.

- [ ] **Step 3: Extend process parsing and implement client**

Parse `kind: 'event'` before correlated response validation. Retain the one-megabyte line bound and strict schema validation. The live client owns bounded append admission, one in-flight append per stream, expected sequence, generation, event revision, abort signals, finite timeouts, and stale-event rejection.

- [ ] **Step 4: Add failure tests**

Cover malformed/oversized events, unknown source, duplicate event revision, stale generation, queue overflow, append timeout, process exit, flush after last accepted append, cancel/no-late-event, and two-stream isolation.

Run: `pnpm exec vitest run tests/unit/parakeetLiveClient.test.ts tests/unit/nativeJsonLineProcess.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/transcription/nativeJsonLineProcess.ts electron/transcription/parakeetLiveClient.ts tests/unit/parakeetLiveClient.test.ts
git commit -m "feat(transcription): add bounded Parakeet live client (#630)"
```

### Task 5: Causal replay metrics and report sanitizer

**Files:**
- Create: `src/services/liveTranscriptionReplayMetrics.ts`
- Create: `src/services/liveTranscriptionReplay.ts`
- Test: `tests/unit/liveTranscriptionReplayMetrics.test.ts`

- [ ] **Step 1: Write failing invariant and sanitizer tests**

```ts
it('fails any committed-prefix mutation in any repetition', () => {
  const verdict = evaluateLiveReplay([{ committedSnapshots: ['one two', 'one x'] }]);
  expect(verdict.invariants.confirmedPrefixViolations).toBe(1);
  expect(verdict.status).toBe('fail');
});

it('refuses report fields containing text, paths, or per-meeting rows', () => {
  expect(() => sanitizeLiveReplayReport({ transcript: 'private' })).toThrow('private_report_field');
  expect(() => sanitizeLiveReplayReport({ audioPath: '/private/a.wav' })).toThrow('private_report_field');
  expect(() => sanitizeLiveReplayReport({ meetings: [{}] })).toThrow('private_report_field');
});
```

- [ ] **Step 2: Run Vitest and verify RED**

Run: `pnpm exec vitest run tests/unit/liveTranscriptionReplayMetrics.test.ts`  
Expected: FAIL because the metrics modules do not exist.

- [ ] **Step 3: Implement pure causal metrics**

Implement virtual availability/completion clocks, first text from first sealed activity, changed-publication cadence, post-lookahead processing latency, RTF, committed-prefix mutation, volatile rollback, seam duplication/omission, exact source coverage, gap repair bounds, batch-agreement diagnostics, MLX proxy non-regression, RSS slope, thermal distribution, percentile calculation, and deterministic bootstrap bounds.

The report type must encode:

```ts
type PrivateLiveReplayReport = {
  schemaVersion: 1;
  benchmark: 'parakeet_live_causal_replay';
  referencePolicy: {
    batchParakeet: 'consistency_diagnostic_not_ground_truth';
    persistedCanonical: 'existing_local_transcript_proxy_not_human_ground_truth';
  };
  corpus: { meetingCount: number; sourceCount: number; audioMinutesRoundedTo5: number };
  runtime: { fluidAudioVersion: string; fluidAudioRevision: string; modelId: string; configId: string };
  engines: Record<'mlxProduction' | 'parakeetSliding', { status: 'pass' | 'fail' | 'unavailable'; metrics: Record<string, number | boolean | string> }>;
  invariants: Record<string, number>;
  failures: string[];
};
```

- [ ] **Step 4: Encode the design thresholds as named constants and test every boundary**

Do not tune thresholds after seeing private text. Test exact pass, just-inside, and just-outside values. Batch agreement can reject but never establish linguistic accuracy.

Run: `pnpm exec vitest run tests/unit/liveTranscriptionReplayMetrics.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscriptionReplay.ts src/services/liveTranscriptionReplayMetrics.ts tests/unit/liveTranscriptionReplayMetrics.test.ts
git commit -m "feat(transcription): define causal live replay gates (#630)"
```

### Task 6: Private manifest and executable replay

**Files:**
- Create: `scripts/validate_private_parakeet_live_manifest.ts`
- Create: `scripts/run_private_parakeet_live_replay.ts`
- Create: `tests/unit/privateParakeetLiveManifest.test.ts`
- Modify: `package.json`
- Modify: `docs/dev.md`

- [ ] **Step 1: Write failing manifest validator tests**

```ts
it('requires three eligible dual-source meetings and rejects mixed mic', () => {
  expect(() => validatePrivateLiveReplayManifest({ schemaVersion: 1, meetings: [] })).toThrow('insufficient_corpus');
  expect(() => validatePrivateLiveReplayManifest(makeManifest({ micEqualsMixed: true }))).toThrow('mixed_mic_source');
});

it('rejects inline text and audio data', () => {
  expect(() => validatePrivateLiveReplayManifest(makeManifest({ transcript: 'private' }))).toThrow('private_content_not_allowed');
  expect(() => validatePrivateLiveReplayManifest(makeManifest({ audio: 'base64' }))).toThrow('private_content_not_allowed');
});
```

- [ ] **Step 2: Run Vitest and verify RED**

Run: `pnpm exec vitest run tests/unit/privateParakeetLiveManifest.test.ts`  
Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement manifest validation and corpus selection**

Require at least three meetings, 90 aggregate minutes rounded only in output, one 30-minute meeting, independent mic/System files, source duration within five seconds of sealed duration, sealed generation, and no unresolved capture gap. Validate absolute local paths without printing them. Return `insufficient_corpus` rather than PASS when eligibility is not met.

- [ ] **Step 4: Implement the causal runner**

Decode sources internally to 16 kHz mono and release 250 ms frames. MLX must use the production five-second queue behavior. Parakeet must use `ParakeetLiveClient`. Run pinned default and two-second candidate configurations three warm times with alternating order. Externally sample RSS every 250 ms. The real-time soak samples thermal and memory once per second on the longest meeting. Add early/middle/late two-second gap injections and prove targeted repair.

The CLI prints only finite verdicts and `report written`; it never prints output paths, transcript text, per-meeting results, stderr, or arbitrary exceptions.

- [ ] **Step 5: Add commands and documentation**

```json
{
  "benchmark:private-parakeet-live:validate": "node --experimental-strip-types scripts/validate_private_parakeet_live_manifest.ts",
  "benchmark:private-parakeet-live": "node --experimental-strip-types scripts/run_private_parakeet_live_replay.ts"
}
```

Document causal and real-time-soak commands, the no-human-review rule, and why batch Parakeet is diagnostic only.

- [ ] **Step 6: Verify unit and CLI failure paths**

Run:

```bash
pnpm exec vitest run tests/unit/privateParakeetLiveManifest.test.ts tests/unit/liveTranscriptionReplayMetrics.test.ts
pnpm run benchmark:private-parakeet-live:validate -- --manifest /definitely/missing.json
```

Expected: tests PASS; CLI exits non-zero with finite `manifest_unavailable` and no path echo.

- [ ] **Step 7: Commit**

```bash
git add scripts/validate_private_parakeet_live_manifest.ts scripts/run_private_parakeet_live_replay.ts tests/unit/privateParakeetLiveManifest.test.ts package.json docs/dev.md
git commit -m "feat(transcription): add private Parakeet live replay (#630)"
```

### Task 7: Native integration, private execution, and decision

**Files:**
- Create: `tests/manual/parakeetLiveCausalReplay.test.ts`
- Modify: `vitest.manual.config.ts`
- Modify: `docs/adr/2026-08-15-parakeet-final-transcription.md`
- Create: `docs/changelog/entries/2026-08-15-630-parakeet-live-feasibility.md`

- [ ] **Step 1: Add a guarded real-runtime test**

The test starts the pinned native process, opens isolated mic/System synthetic streams, interleaves events with status requests, verifies no cross-source token state, flushes a short tail, cancels a second generation, and asserts no late events. It runs only when `RUN_PARAKEET_LIVE_CAUSAL_REPLAY=1` and uses test-owned temporary data.

- [ ] **Step 2: Build and run focused verification**

```bash
pnpm run build-native
swift test --package-path native/parakeet-runtime
pnpm exec vitest run tests/unit/liveTranscriptionStablePrefix.test.ts tests/unit/parakeetLiveClient.test.ts tests/unit/liveTranscriptionReplayMetrics.test.ts tests/unit/privateParakeetLiveManifest.test.ts
pnpm exec tsc --noEmit
pnpm exec biome check .
```

Expected: all PASS.

- [ ] **Step 3: Run the private causal replay**

```bash
pnpm run benchmark:private-parakeet-live:validate -- --manifest "$PLUTO_PRIVATE_LIVE_REPLAY_MANIFEST"
pnpm run benchmark:private-parakeet-live -- --manifest "$PLUTO_PRIVATE_LIVE_REPLAY_MANIFEST" --mode causal --repetitions 3 --out "$PLUTO_PRIVATE_LIVE_REPLAY_REPORT"
```

Expected: a sanitized verdict for pinned default and low-latency candidate; no private fields.

- [ ] **Step 4: Run the one-timescale soak**

```bash
pnpm run benchmark:private-parakeet-live -- --manifest "$PLUTO_PRIVATE_LIVE_REPLAY_MANIFEST" --mode realtime-soak --out "$PLUTO_PRIVATE_LIVE_REPLAY_SOAK_REPORT"
```

Expected: bounded RSS/thermal verdict and cleanup evidence.

- [ ] **Step 5: Record the decision without overstating accuracy**

If all gates pass, amend the ADR with the exact approved configuration and authorize a separate recording-integration plan while retaining MLX/AEC/batch guards. If any gate fails, record the finite failing metrics and keep MLX primary. Never claim lexical accuracy improvement from batch agreement or the persisted canonical proxy.

- [ ] **Step 6: Add changelog and issue evidence**

Create the six-field #630 changelog fragment and post content-free aggregate results to #630. Link #629 as `dependency_unavailable` until streaming AEC passes.

- [ ] **Step 7: Run final verification and commit**

```bash
pnpm test
pnpm run changelog:check
pnpm exec tsc --noEmit
pnpm exec biome check .
git diff --check
git add tests/manual/parakeetLiveCausalReplay.test.ts vitest.manual.config.ts docs/adr/2026-08-15-parakeet-final-transcription.md docs/changelog/entries/2026-08-15-630-parakeet-live-feasibility.md
git commit -m "test(transcription): evaluate Parakeet live feasibility (#630)"
```

Expected: 154 or more Vitest files pass, Swift tests pass, changelog validates, TypeScript and Biome are clean, and the worktree has no uncommitted implementation files.

## Promotion decision

Passing this plan authorizes a second issue-backed plan to integrate the proven live client with `AudioManager`, capture-journal stream coverage, presentation state, one-way MLX fallback, streaming AEC evidence, flush/gap repair, and canonical commit. It does not itself switch the user-visible engine.

Failing this plan leaves MLX live plus whole-session Parakeet finalization unchanged and records which claim failed. The implementation seams remain useful only if they are safe, content-free, and do not complicate the current path.
