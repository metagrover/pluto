# Parakeet Primary Meeting Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a feature-flagged, AEC-protected Parakeet live transcript with bounded memory, receipt-level evidence, one-way MLX fallback, and unchanged canonical-finalization safety.

**Architecture:** Pluto keeps its durable five-second mic/System capture-journal intervals. The Electron main process pairs authoritative receipts and sends approved WAV paths to a packaged native AEC runtime, which writes a derived residual mic artifact and content-free evidence without modifying raw capture. A shared, exclusive-inference Parakeet host consumes clean System plus only trusted residual mic receipts. Rollout proceeds through system shadow, dual shadow, internal primary, and canary; the current full-session final path remains authoritative.

**Tech Stack:** Electron, React, TypeScript, Vitest, Swift 6, Core ML, vendored FluidAudio 0.15.5 / Parakeet TDT v3, capture-journal receipts, a packaged native AEC runtime selected by frozen synthetic gates, and MLX fallback.

**Issues:** [#630](https://github.com/metagrover/pluto/issues/630), [#629](https://github.com/metagrover/pluto/issues/629), stacked on [#441](https://github.com/metagrover/pluto/issues/441) / draft PR #628.

---

## 1. Current checkpoint and decisions

At plan authorship, `codex/630-parakeet-live` is clean at `26b4e5d2` with 29 commits beyond the #441 stack.

Approved and reusable:

- Stable committed-prefix/tentative contracts.
- Strict live protocol, bounded dual-source native sessions, and acknowledged FluidAudio ingestion.
- Correlated Electron transport and `ParakeetLiveClient`.
- `pinned-default` and `low-latency-2s` process configurations.
- Pure replay metrics, thresholds, privacy sanitizer, and guarded synthetic runtime test.

Implemented but not promotion-approved:

- `scripts/run_private_parakeet_live_replay.ts` and its orchestration tests. Remaining semantic fixes are Task 4.

Not implemented:

- Rolling AEC, shared live/final runtime ownership, real meeting-flow shadow/primary integration, recent-meeting replay, or production rollout.

Frozen decisions:

1. Raw mic and System artifacts are immutable.
2. Raw mic never enters Parakeet-primary local-speaker evidence.
3. DSP and inference never run on renderer/capture callbacks.
4. Five-second durable intervals remain the initial handoff unit; do not add high-frequency PCM IPC.
5. Modes progress `mlx` -> `system_shadow` -> `dual_shadow` -> `parakeet_primary`.
6. Mid-meeting Parakeet/AEC failure causes one-way fallback to MLX, never demotion to another Parakeet mode.
7. Preview text remains provisional. Analysis still starts only after canonical DB commit.
8. Initial rollout retains the full final pass because live flush has no timed words.
9. Benchmarks compare MLX and Parakeet sequentially. Shadow necessarily runs both, but only behind a combined-memory watchdog.
10. No new human rating workflow. Automated evidence supports engineering fit/non-regression, not an absolute accuracy claim.
11. #441/PR #628 is a draft dependency, not landed production. Production integration cannot ship until #628 lands or #630 is rebased with equivalent finalization behavior preserved.

Identity domains are never conflated:

```ts
type CaptureGeneration = string;
type CaptureSequence = number;       // zero-based journal interval
type ParakeetGeneration = number;    // positive safe integer
type ParakeetSequence = number;      // one-based append identity
type EngineEpoch = number;           // increments on fallback

const toParakeetSequence = (captureSequence: CaptureSequence): ParakeetSequence =>
  captureSequence + 1;
```

---

## 2. Terra/Luna workflow protocol

### Model routing

| Work | Model | Effort |
|---|---|---:|
| Contracts, fixtures, reducers, serializers, docs | `gpt-5.6-luna` | high |
| Mechanical verification and plan/checklist updates | `gpt-5.6-luna` | medium |
| Native AEC/backend selection, lifecycle, Electron coordination | `gpt-5.6-terra` | high |
| Capture journal, `AudioManager`, fallback/finalization integration | `gpt-5.6-terra` | xhigh |
| Spec review for narrow Luna tasks | fresh `gpt-5.6-luna` | high |
| Concurrency/security/memory review | fresh `gpt-5.6-terra` | xhigh |

Each task uses a fresh implementer and strict TDD:

1. Write one failing behavior test and run it to record RED.
2. Implement the minimum behavior and record focused GREEN.
3. Run relevant full checks, self-review, commit only owned files.
4. Fresh spec reviewer checks exact scope.
5. Implementer fixes gaps; repeat until compliant.
6. Fresh Terra quality reviewer checks memory, lifecycle, privacy, and recovery.
7. Implementer fixes; repeat until approved.
8. Only then integrate.

### Isolated worktrees

Run these commands only after Task 0 Step 4 has committed and pushed the plan, so every lane branches from the documented checkpoint.

From `/Users/metagrover/Desktop/pluto`, record one immutable base and validate targets before creating them:

```bash
BASE_SHA="$(git -C /Users/metagrover/Desktop/pluto/.worktrees/630-parakeet-live rev-parse HEAD)"
test -n "$BASE_SHA"
test ! -e /Users/metagrover/Desktop/pluto/.worktrees/629-aec-contracts
git worktree add /Users/metagrover/Desktop/pluto/.worktrees/629-aec-contracts \
  -b codex/629-aec-contracts "$BASE_SHA"
```

Repeat with unique absolute targets for `630-runtime-host`, `630-live-policy`, and `630-eval-correctness`. Later waves branch from a recorded integration SHA, never a moving branch name. Parallel agents must not share a worktree.

### File ownership

| Lane | Owns | Forbidden parallel overlap |
|---|---|---|
| AEC contracts | `src/services/streamingAec/**`, fixtures | Electron, journal, renderer |
| Runtime host | `electron/transcription/parakeetRuntimeHost*`, client wiring | AEC/runtime evaluator |
| Live policy | pure `src/services/liveTranscription/**` reducers | renderer, Electron |
| Replay correctness | replay/metrics/tests, resource probe | runtime-host files, renderer |
| AEC backend/runtime | `native/aec-runtime/**` | journal/main/renderer |
| System shadow | live meeting coordinator + narrow main observer | AEC coordinator |
| AEC persistence | sidecars/journal attachment/coordinator | system-shadow main edits until rebased |
| Primary integration | `AudioManager`, renderer IPC bridge, stop tests | all other integration edits |

---

## 3. Dependency graph

```text
Wave 0: checkpoint + issue alignment
  |
  +--> 1 AEC contracts (Luna) ---------> 5 AEC backend selection/runtime (Terra)
  +--> 2 exclusive runtime host (Terra) -> 6 system shadow (Terra) -> 6B shadow soak
  +--> 3 pure policy/fallback (Luna) ----+
  +--> 3B persistent rollout store (Terra) -> 6 system shadow
  +--> 4A replay semantics (Terra) ------+-> 4B resource probe (Terra)
                                           |
5 + 6 + gates --> 7A AEC sidecars/journal --> 7B AEC coordinator --> 7C AEC gate
                                           |
                                           v
                         8A dual shadow -> 8B renderer primary
                                           |
                                           v
                                  8C fallback boundary
                                           |
                                           v
                                  8D stop/final ordering
                                           |
                                           v
                            9 staged replay/shadow/canary

Timed-word / conditional-final work is a separate follow-up issue and does not block #630.
```

---

## Task 0: Checkpoint the foundation and update issue direction

**Agent:** Luna medium; Terra high checkpoint review.
**Parallel:** No.

**Files:**

- Modify: `docs/superpowers/plans/2026-08-15-parakeet-live-feasibility.md`
- Modify: `docs/superpowers/plans/2026-08-15-parakeet-primary-execution.md`

- [x] **Step 1: Verify clean foundation without loading models**

```bash
git status --short
swift test --package-path native/parakeet-runtime
pnpm exec vitest run \
  tests/unit/liveTranscriptionStablePrefix.test.ts \
  tests/unit/parakeetLiveClient.test.ts \
  tests/unit/liveTranscriptionReplayMetrics.test.ts
pnpm exec tsc --noEmit
git diff --check
```

- [x] **Step 2: Update #629 scope**

Comment on #629 that execution now includes rolling shadow AEC after every durable paired interval, Electron-owned processing, receipt-bound evidence, fail-closed Parakeet handoff, and no additional human review. Preserve post-seal AEC processing as the final-path fallback.

- [x] **Step 3: Record status in the old feasibility plan**

Mark Tasks 1-5 and the guarded runtime test complete; mark the private runner implemented but not promotion-approved; list Task 4A's remaining semantic issues.

- [x] **Step 4: Commit, verify clean HEAD, then push**

```bash
git add docs/superpowers/plans/2026-08-15-parakeet-live-feasibility.md \
  docs/superpowers/plans/2026-08-15-parakeet-primary-execution.md
git commit -m "docs: plan Parakeet primary meeting flow (#630)"
git status --short
git push -u origin codex/630-parakeet-live
```

Create/update a stacked draft PR only after the push. State that user-visible behavior is unchanged and #628 must land first or be preserved during rebase.

- [ ] **Step 5: Record the immutable integration base and create Wave 1 worktrees**

Use the just-pushed Task 0 commit as `BASE_SHA`, validate every absolute target is absent, and create the four isolated worktrees described above. Record `BASE_SHA` in #630 before dispatching agents.

---

## Task 1: Define AEC contracts and frozen synthetic gates

**Agent:** Luna high.
**Parallel:** Wave 1.
**Issue:** #629.

**Files:**

- Create: `src/services/streamingAec/contracts.ts`
- Create: `src/services/streamingAec/evidence.ts`
- Create: `src/services/streamingAec/syntheticFixtures.ts`
- Create: `tests/unit/streamingAecEvidence.test.ts`
- Create: `tests/unit/streamingAecSyntheticFixtures.test.ts`

- [ ] **Step 1: Write RED schema tests**

Define these exact public shapes:

```ts
type AecWorkerRequest = {
  schemaVersion: 1;
  captureGeneration: string;
  captureSequence: number;
  intervalStartSeconds: number;
  intervalEndSeconds: number;
  micPath: string;
  systemPath: string;
  outputPath: string;
};

type AecReceiptBase = {
  schemaVersion: 1;
  captureGeneration: string;
  captureSequence: number;
  intervalStartSeconds: number;
  intervalEndSeconds: number;
  micChecksum: string;
  algorithmVersion: string;
  backendRevision: string;
  algorithmConfigDigest: string;
  sampleRateHz: 16000;
  channelCount: 1;
  resamplerVersion: string;
};

type TrustedAecAudioReceipt = AecReceiptBase & {
  verdict: 'trusted';
  systemChecksum: string;
  derivedChecksum: string;
  derivedAudioRelativePath: string;
  referenceCoverage: number;
  estimatedDelayMs: number;
  driftPpm: number;
  preCorrelation: number;
  postCorrelation: number;
  erleDb: number;
  doubleTalk: boolean;
  clipped: boolean;
  weakReference: boolean;
  confidence: number;
  failure?: never;
};

type AecFailure = 'missing_reference' | 'coverage_mismatch' | 'weak_reference' |
    'clipping' | 'low_confidence' | 'sequence_gap' | 'timeout' |
    'worker_exit' | 'queue_overflow' | 'owner_destroyed' | 'cancelled' |
    'shutdown' | 'path_rejected' | 'unsupported_audio' |
    'duration_mismatch' | 'output_invalid' | 'checksum_mismatch' |
    'backend_failed';

type UntrustedAecAudioReceipt = AecReceiptBase & {
  verdict: 'untrusted';
  failure: AecFailure;
  systemChecksum?: string;
  derivedChecksum?: string;
  derivedAudioRelativePath?: string;
  metrics?: Partial<Pick<TrustedAecAudioReceipt,
    'referenceCoverage' | 'estimatedDelayMs' | 'driftPpm' |
    'preCorrelation' | 'postCorrelation' | 'erleDb' | 'confidence'>>;
};

type AecAudioReceipt = TrustedAecAudioReceipt | UntrustedAecAudioReceipt;
```

Worker requests are private internal IPC and may contain approved absolute paths. Persisted/report evidence uses the receipt and may contain only relative paths plus finite allowlisted fields. Tests reject trusted receipts with a failure and untrusted receipts without a finite failure, and cover every terminal failure code. They recursively reject transcript text, human/meeting/device identity, audio/base64, arbitrary exception, arbitrary identifiers, and absolute-path fields while explicitly allowing capture generation, sequence, bounds, and checksums as provenance. The configuration digest binds backend revision, algorithm parameters, 16 kHz mono policy, and resampler version.

- [ ] **Step 2: Add seeded fixtures and frozen gates**

Fixtures cover System-only, mic-only, double-talk, 0-200 ms delay, +/-100 ppm drift, reverb, silence, weak reference, and clipping.

```ts
export const STREAMING_AEC_GATES = {
  systemOnlyMedianErleDb: 15,
  systemOnlyMaxPostCorrelation: 0.20,
  systemOnlyMinCorrelationReduction: 0.70,
  micOnlyMaxLevelChangeDb: 1,
  micOnlyMaxSiSdrLossDb: 1,
  doubleTalkMinRemoteErleDb: 8,
  doubleTalkMaxLocalAttenuationDb: 3,
  maxDelayErrorMsP95: 10,
  maxAbsDriftPpm: 100,
} as const;
```

Test exact, just-inside, and just-outside boundaries. SI-SDR/local-component gates apply only to synthetic fixtures with known sources; recent meetings cannot claim those metrics.

- [ ] **Step 3: Run RED, implement minimum contracts, and verify**

```bash
pnpm exec vitest run \
  tests/unit/streamingAecEvidence.test.ts \
  tests/unit/streamingAecSyntheticFixtures.test.ts
pnpm exec tsc --noEmit
git diff --check
```

- [ ] **Step 4: Commit**

```bash
git add src/services/streamingAec tests/unit/streamingAec*.test.ts
git commit -m "feat(audio): define rolling AEC evidence (#629)"
```

---

## Task 2: Introduce an exclusive shared Parakeet runtime host

**Agent:** Terra high.
**Parallel:** Wave 1.
**Issue:** #630.

**Files:**

- Create: `electron/transcription/parakeetRuntimeHost.ts`
- Modify: `electron/transcription/parakeetFinalClient.ts`
- Modify: `electron/transcription/parakeetLiveClient.ts`
- Modify: `electron/main.ts`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/LiveProtocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetLiveSession.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/LiveProtocolTests.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetLiveSessionTests.swift`
- Create: `tests/unit/parakeetRuntimeHost.test.ts`

- [ ] **Step 1: Write RED exact receipt-provenance tests**

Add finite integer fields `committedThroughSequence` and `tentativeThroughSequence` to native updates and Electron events. When `qualifiesPriorTentative` promotes the prior update, `committedThroughSequence` advances only to that prior append; the current append remains `tentativeThroughSequence`. Reject regressions, impossible future sequences, and float-derived sequence inference. Electron maps those exact Parakeet sequences back to capture receipts.

- [ ] **Step 2: Write RED exclusive-lease tests**

```ts
it('reuses one child but never overlaps live and final inference', async () => {
  const host = makeRuntimeHost();
  const finalLease = await host.acquireFinal();
  const livePromise = host.acquireLive();
  await expectPending(livePromise);
  await finalLease.cancelAndPersistForRetry();
  await expect(livePromise).resolves.toMatchObject({ kind: 'live' });
  expect(host.spawnCount()).toBe(1);
});
```

Final acquisition while live is active is queued or denied with a finite code. Recording start cancels the final request, waits for child quiescence, persists/requeues interrupted finalization, and only then grants live ownership. Reuse one process/model; never infer concurrently.

- [ ] **Step 3: Implement one workload-class lease**

Diagnostics expose only state and counts. Neither client owns process termination. Child exit invalidates borrowers once. Idle unload occurs only with no lease and no durable retry handoff.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/parakeetRuntimeHost.test.ts \
  tests/unit/parakeetLiveClient.test.ts
swift test --package-path native/parakeet-runtime
pnpm exec tsc --noEmit
pnpm exec biome check electron/transcription tests/unit/parakeetRuntimeHost.test.ts
git diff --check
git add electron/transcription electron/main.ts native/parakeet-runtime \
  tests/unit/parakeetRuntimeHost.test.ts
git commit -m "refactor(transcription): serialize Parakeet runtime ownership (#630)"
```

---

## Task 3: Define pure rollout, projection, and receipt-bound fallback

**Agent:** Luna high.
**Parallel:** Wave 1.
**Issue:** #630.

**Files:**

- Create: `electron/transcription/liveTranscriptionPolicy.ts`
- Modify: `src/services/liveTranscription/contracts.ts`
- Create: `src/services/liveTranscription/liveEngineStateMachine.ts`
- Create: `src/services/liveTranscription/liveTranscriptProjection.ts`
- Create: `tests/unit/liveTranscriptionPolicy.test.ts`
- Create: `tests/unit/liveEngineStateMachine.test.ts`
- Create: `tests/unit/liveTranscriptProjection.test.ts`

- [ ] **Step 1: Write RED admission and transition tests**

Admission may select `system_shadow` when AEC is unavailable. After primary starts, AEC failure must switch to MLX—not system shadow.

```ts
expect(transition(primaryState, {
  type: 'aec_failed',
  captureSequence: 8,
})).toMatchObject({ mode: 'mlx', engineEpoch: 2 });
```

- [ ] **Step 2: Define the exact fallback splice boundary**

State records exact integer provenance from the native update contract:

- last Parakeet admitted capture receipt;
- last Parakeet processed receipt;
- last committed-preview receipt and `committedThroughCaptureSequence`;
- current tentative receipt and `tentativeThroughCaptureSequence`;
- first MLX receipt;
- overlap range and dedup decision;
- engine epoch.

Fallback fences/stops Parakeet before MLX inference when combined memory admission requires it. The splice must prove no uncovered or duplicate receipt. Tentative Parakeet tail is discarded; committed preview is retained.

- [ ] **Step 3: Implement presentation projection**

Stable IDs bind source, engine epoch, Parakeet generation, and revision. Projection may replace tentative text but cannot mutate committed history or label it canonical.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/liveTranscriptionPolicy.test.ts \
  tests/unit/liveEngineStateMachine.test.ts \
  tests/unit/liveTranscriptProjection.test.ts \
  tests/unit/liveTranscriptionStablePrefix.test.ts
pnpm exec tsc --noEmit
git diff --check
git add electron/transcription/liveTranscriptionPolicy.ts \
  src/services/liveTranscription tests/unit/liveTranscriptionPolicy.test.ts \
  tests/unit/liveEngineStateMachine.test.ts \
  tests/unit/liveTranscriptProjection.test.ts
git commit -m "feat(transcription): define Parakeet live rollout policy (#630)"
```

---

## Task 3B: Persist rollout state and atomic rollback

**Agent:** Terra high.
**Parallel:** Wave 1 after Task 3 contracts are fixed.
**Issue:** #630.

**Files:**

- Create: `electron/transcription/liveTranscriptionRolloutStore.ts`
- Create: `tests/unit/liveTranscriptionRolloutStore.test.ts`

- [ ] **Step 1: Write RED storage tests**

Default mode is `mlx`. Validate every stored mode/config/digest, use atomic owner-only replacement, persist only content-free stage and rollback counters, and recover corrupt/missing state as MLX. A watchdog rollback must be durable before later Parakeet events can publish; restart must remain on MLX.

- [ ] **Step 2: Implement the minimal store**

Expose finite read/promote/rollback operations without wiring `electron/main.ts` in this parallel lane. Promotion requires the approved stage evidence digest. Rollback is monotonic for the meeting/engine epoch and cannot be overwritten by a stale success event. Task 6A owns the main-process wiring after Task 2 is integrated.

- [ ] **Step 3: Verify and commit**

```bash
pnpm exec vitest run tests/unit/liveTranscriptionRolloutStore.test.ts
pnpm exec tsc --noEmit
git diff --check
git add electron/transcription/liveTranscriptionRolloutStore.ts \
  tests/unit/liveTranscriptionRolloutStore.test.ts
git commit -m "feat(transcription): persist safe live rollout state (#630)"
```

---

## Task 4A: Correct replay semantics and add staged CLI modes

**Agent:** Terra high.
**Parallel:** Wave 1; no model execution.
**Issue:** #630.

**Files:**

- Modify: `scripts/run_private_parakeet_live_replay.ts`
- Modify: `tests/unit/privateParakeetLiveOrchestration.test.ts`
- Modify: `src/services/liveTranscriptionReplayMetrics.ts`
- Modify: `tests/unit/liveTranscriptionReplayMetrics.test.ts`

- [ ] **Step 1: Write RED tests for all unresolved findings**

Tests must prove:

- native events bucket by `streamId + source + generation`;
- cumulative committed-preview state, not tentative `event.text`, drives stability;
- first activity is causal, never hardcoded zero;
- MLX evidence joins by repetition/meeting/source;
- seam scoring uses actual 11-second or 2-second recognizer boundaries;
- spawn/exit/cleanup uncertainty is fatal;
- repair words all lie inside the requested window and outside splice is unchanged;
- scoring uses `reconcileCanonicalTranscript` from `src/utils/transcriptIntegrity.ts`, not raw per-source comparisons;
- online retention remains bounded for a 90-minute synthetic stream.

- [ ] **Step 2: Add executable staged modes**

```text
--stage preflight --repetitions 1
--stage promotion --config pinned-default|low-latency-2s --repetitions 3
--stage realtime-soak --config pinned-default|low-latency-2s
```

Preflight emits a content-free owner-only selection artifact:

```ts
type LiveConfigSelection = {
  schemaVersion: 1;
  selected: 'pinned-default' | 'low-latency-2s' | 'none';
  reasons: LiveConfigSelectionReason[];
  evidenceDigest: string;
};

type LiveConfigSelectionReason =
  | 'pinned_default_only_pass'
  | 'low_latency_only_pass'
  | 'both_pass_low_latency_wins'
  | 'both_pass_pinned_default_wins'
  | 'no_config_passed';
```

`LiveConfigSelectionReason` is a finite allowlist. `evidenceDigest` binds the runner revision, threshold revision, model ID, FluidAudio version/revision, AEC algorithm/config revision, and corpus digest. Promotion and soak require `--selection <owner-only-path>`, reject a stale or mismatched digest, run only the selected config, and never rerun the loser.

Exact staged commands are:

```bash
pnpm run replay:parakeet-live -- --stage preflight --repetitions 1 --selection "$SELECTION_PATH"
pnpm run replay:parakeet-live -- --stage promotion --config "$WINNER" --repetitions 3 --selection "$SELECTION_PATH"
pnpm run replay:parakeet-live -- --stage realtime-soak --config "$WINNER" --selection "$SELECTION_PATH"
```

- [ ] **Step 3: Preserve separate comparison questions**

Use identical AEC-cleaned inputs when comparing MLX and Parakeet engines. Separately compare current end-to-end workflow versus candidate workflow. Never label per-source raw disagreement an accuracy score.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/privateParakeetLiveOrchestration.test.ts \
  tests/unit/liveTranscriptionReplayMetrics.test.ts
pnpm exec tsc --noEmit
git diff --check
git add scripts/run_private_parakeet_live_replay.ts \
  tests/unit/privateParakeetLiveOrchestration.test.ts \
  src/services/liveTranscriptionReplayMetrics.ts \
  tests/unit/liveTranscriptionReplayMetrics.test.ts
git commit -m "fix(transcription): make Parakeet replay causal (#630)"
```

---

## Task 4B: Add an independent packaged resource probe

**Agent:** Terra high.
**Depends on:** Approved and integrated Task 4A commit; Task 2 interface must also be fixed.
**Issue:** #630.

**Files:**

- Create: `native/parakeet-runtime/Sources/ParakeetResourceProbe/main.swift`
- Create: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/ThermalState.swift`
- Modify: `native/parakeet-runtime/Package.swift`
- Create: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ThermalStateTests.swift`
- Modify: `scripts/build_parakeet.sh`
- Modify: `electron-builder.json5`
- Modify: replay runner/tests to consume the probe.

- [ ] **Step 1: Write RED probe tests**

The probe accepts a target PID and emits bounded JSON lines containing monotonic wall time, target RSS bytes, and finite `ProcessInfo.processInfo.thermalState`. It samples independently while the target is blocked.

- [ ] **Step 2: Implement and package the separate executable**

Do not query thermal state through the inference request queue. Validate PID, cap line size, suppress arbitrary errors, terminate on parent/target exit, and prove cleanup.

- [ ] **Step 3: Add a blocked-inference test**

Hold a fake target request blocked for at least two sample intervals and assert the probe continues emitting measured samples.

- [ ] **Step 4: Verify and commit**

```bash
swift test --package-path native/parakeet-runtime
pnpm run build-native
pnpm exec vitest run tests/unit/privateParakeetLiveOrchestration.test.ts
git diff --check
git add native/parakeet-runtime scripts/build_parakeet.sh electron-builder.json5 \
  scripts/run_private_parakeet_live_replay.ts \
  tests/unit/privateParakeetLiveOrchestration.test.ts
git commit -m "feat(transcription): add independent resource probe (#630)"
```

---

## Task 5A: Select an established AEC backend against frozen gates

**Agent:** Terra xhigh.
**Depends on:** Task 1.
**Issue:** #629.

**Files:**

- Create: `native/aec-runtime/README.md`
- Create: `native/aec-runtime/Package.swift`
- Create: `native/aec-runtime/Sources/AecBenchmark/main.swift`
- Create: `native/aec-runtime/Tests/AecBenchmarkTests/AecBackendSelectionTests.swift`
- Create: `scripts/run_aec_backend_selection.ts`
- Create: `tests/unit/aecBackendSelection.test.ts`
- Create: `docs/adr/2026-08-15-rolling-aec-backend.md`

- [ ] **Step 1: Build one common fixture adapter**

Evaluate, in order:

1. a locally buildable WebRTC AEC3 integration;
2. Apple VoiceProcessingIO only if it supports deterministic paired-buffer/file replay;
3. the bounded adaptive-filter prototype as a diagnostic baseline, not an automatic winner.

Before adding a dependency, record license, exact revision, package size, offline build, Apple Silicon support, and maintenance cost. Stop at the first candidate that passes every frozen quality, license, offline-build, and packaging gate. Remove losing prototypes before committing; do not ship multiple production backends.

- [ ] **Step 2: Run identical synthetic gates**

The Task 5A bridge materializes Task 1's exact seeded TypeScript arrays into temporary WAV files plus a manifest, invokes each native candidate, and scores output with the single frozen TypeScript gate implementation. Do not recreate fixture generation or scoring in Swift. Each candidate must also satisfy deterministic output, bounded cleanup, and RTF <= 0.20.

- [ ] **Step 3: Commit a finite decision**

The ADR decision is exactly one of:

- `webrtc_aec3_selected`;
- `voice_processing_io_selected`;
- `adaptive_filter_selected_with_limits`;
- `aec_backend_unavailable`.

If unavailable, stop #629/#630 primary work and keep MLX/full final behavior. Do not begin Task 5B.

- [ ] **Step 4: Verify and commit**

```bash
swift test --package-path native/aec-runtime
pnpm exec vitest run tests/unit/aecBackendSelection.test.ts
git diff --check
git add native/aec-runtime scripts/run_aec_backend_selection.ts \
  tests/unit/aecBackendSelection.test.ts \
  docs/adr/2026-08-15-rolling-aec-backend.md
git commit -m "test(audio): select a rolling AEC backend (#629)"
```

---

## Task 5B: Package the selected native AEC runtime

**Agent:** Terra high.
**Depends on:** Task 5A selected a backend.
**Issue:** #629.

**Files:**

- Create/modify: `native/aec-runtime/Sources/AecRuntime/**`
- Create: `native/aec-runtime/Tests/AecRuntimeTests/**`
- Create: `electron/audio/nativeAecProcess.ts`
- Create: `tests/unit/nativeAecProcess.test.ts`
- Create: `scripts/build_aec.sh`
- Modify: `package.json` so `build-native` invokes the AEC and Parakeet build scripts
- Modify: `electron-builder.json5`
- Create: `scripts/run_streaming_aec_synthetic.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED protocol/lifecycle tests**

The Electron coordinator passes approved absolute input/output WAV paths. The native runtime decodes/resamples, processes, writes a temporary derived WAV under the approved artifact root, returns finite evidence/checksum, and retains no audio after acknowledgement.

Reject symlinks, non-regular files, path escape, generation/sequence mismatch, duplicate mismatch, oversized frames, timeout, and cancellation races.

- [ ] **Step 2: Implement one selected backend only**

State persists across contiguous five-second intervals and resets per capture generation. Before processing, decode both inputs and require the configured sample rate/channel policy plus exact duration/sample coverage for the authoritative interval bounds; never pad or truncate a mismatch. Any sequence gap, timeout, untrusted interval, worker restart, cancellation, or backend failure resets adaptive filter/delay state. Subsequent warm-up output stays untrusted until the frozen convergence/reference-confidence gates pass again. One active plus one queued request maximum. No arbitrary logs or content-bearing paths.

- [ ] **Step 3: Add packaged-runtime and synthetic tests**

```json
{
  "scripts": {
    "benchmark:streaming-aec:synthetic": "node --experimental-strip-types scripts/run_streaming_aec_synthetic.ts"
  }
}
```

Test the packaged executable, not only an in-process fake.

- [ ] **Step 4: Verify and commit**

```bash
swift test --package-path native/aec-runtime
pnpm exec vitest run tests/unit/nativeAecProcess.test.ts
pnpm run benchmark:streaming-aec:synthetic
pnpm exec tsc --noEmit
git diff --check
git add native/aec-runtime electron/audio/nativeAecProcess.ts \
  tests/unit/nativeAecProcess.test.ts scripts/build_aec.sh \
  scripts/run_streaming_aec_synthetic.ts package.json electron-builder.json5
git commit -m "feat(audio): package rolling AEC runtime (#629)"
```

---

## Task 6A: Add a system-only Parakeet shadow coordinator

**Agent:** Terra high.
**Depends on:** Tasks 2, 3B, and 4B.
**Issue:** #630.

**Files:**

- Create: `electron/transcription/parakeetLiveMeetingCoordinator.ts`
- Create: `tests/unit/parakeetLiveMeetingCoordinator.test.ts`
- Modify: `electron/main.ts`
- Modify narrowly: `electron/captureJournal.ts` to publish authoritative completed receipts.

- [ ] **Step 1: Write RED authoritative-receipt tests**

The main-process journal completion boundary is the only receipt authority. Map `parakeetSequence = captureSequence + 1` and retain capture sequence/checksum as provenance. Renderer disappearance cannot skip shadow work.

- [ ] **Step 2: Implement system-only shadow**

Wire the Task 3B rollout store in `electron/main.ts`. Start after journal start, append only durable System repair WAV receipts, never publish text to renderer, and fail per meeting without affecting capture/MLX/finalization.

- [ ] **Step 3: Add combined-memory admission/watchdog**

Before shadow, require normal system memory pressure and configured headroom. During shadow, sample MLX + Parakeet + Electron RSS independently and define `combinedTrackedRss = mlxChildRss + parakeetChildRss + electronMainRss`. Abort/unload Parakeet shadow if `combinedTrackedRss > 4.5 GiB`, system free memory < 15%, serious/critical thermal state, or cleanup becomes uncertain. MLX continues.

Tests must prove a watchdog breach fences all later Parakeet events, unloads and proves Parakeet process exit, atomically persists the rollback to MLX, and leaves MLX plus current finalization untouched.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/parakeetLiveMeetingCoordinator.test.ts \
  tests/unit/captureSessionOwnershipBoundary.test.ts
pnpm exec tsc --noEmit
git diff --check
git add electron/transcription/parakeetLiveMeetingCoordinator.ts \
  electron/main.ts electron/captureJournal.ts \
  tests/unit/parakeetLiveMeetingCoordinator.test.ts
git commit -m "feat(transcription): add system-only Parakeet shadow (#630)"
```

---

## Task 6B: Gate system-shadow operation before AEC integration

**Agent:** Luna medium runs commands; Terra high decides.
**Depends on:** Task 6A.

- [ ] **Step 1: Run synthetic lifecycle and packaged-runtime checks**

- [ ] **Step 2: Run at least three internal shadow sessions totaling 60 minutes, including one >= 30 minutes**

Stop on prefix mutation, receipt gap, uncertain cleanup, combined RSS > 4.5 GiB, Parakeet RSS > 2.5 GiB, growth > 64 MiB/hour, serious/critical thermal state, or first-text max > 12 seconds.

- [ ] **Step 3: Record only content-free aggregates on #630**

If the gate fails, keep the code behind an off flag and do not begin dual shadow.

---

## Task 7A: Persist append-only AEC sidecars and attach once at stop

**Agent:** Luna high owns the pure sidecar schema/parser and fixtures; Terra xhigh owns capture-journal mutation and recovery in a following narrow commit.
**Depends on:** Tasks 1 and 5B.
**Issue:** #629.

**Files:**

- Create: `electron/audio/aecEvidenceSidecar.ts`
- Create: `tests/unit/aecEvidenceSidecar.test.ts`
- Modify: `electron/captureJournal.ts`
- Modify: `tests/unit/captureJournal.test.ts`
- Modify: `tests/unit/captureJournalRecovery.test.ts`
- Modify: `tests/unit/captureJournalSealBoundary.test.ts`

- [ ] **Step 1: Luna writes RED sidecar parser tests and commits the pure contract**

The parser consumes the Task 1 discriminated receipt and rejects cross-generation/sequence/bounds/checksum evidence, symlinks, private fields, and malformed trusted/untrusted variants.

```bash
pnpm exec vitest run tests/unit/aecEvidenceSidecar.test.ts
git add electron/audio/aecEvidenceSidecar.ts tests/unit/aecEvidenceSidecar.test.ts
git commit -m "feat(audio): define AEC evidence sidecars (#629)"
```

- [ ] **Step 2: Terra writes RED persistence/recovery tests**

During recording, AEC writes append-only owner-only sidecars and derived files but does not mutate the capture manifest. Every sidecar binds the admitted mic receipt checksum plus capture generation/sequence/bounds and algorithm version. Trusted sidecars additionally require the System and derived checksums; untrusted sidecars bind either checksum only when that input/artifact existed. Tests map owner destruction, cancellation, unsafe paths, invalid output, and checksum failure to their exact finite codes.

- [ ] **Step 3: Define one manifest mutation owner**

At stop, `AudioManager` invokes `AUDIO_CAPTURE_JOURNAL_AEC_DRAIN_ATTACH` through the existing `captureJournalMutationCoordinatorRef`. That one serialized mutation attaches all verified sidecars. No independent main-process revision writer exists.

- [ ] **Step 4: Fail closed in recovery**

Missing/altered/cross-generation/cross-sequence/unsealed sidecars produce explicit untrusted mic intervals. Raw mic is never silently upgraded.

- [ ] **Step 5: Verify and commit the journal mutation**

```bash
pnpm exec vitest run \
  tests/unit/captureJournal.test.ts \
  tests/unit/captureJournalRecovery.test.ts \
  tests/unit/captureJournalSealBoundary.test.ts
git diff --check
git add electron/captureJournal.ts tests/unit/captureJournal*.test.ts
git commit -m "feat(audio): persist rolling AEC sidecars (#629)"
```

---

## Task 7B: Coordinate receipt-bound AEC outside the renderer

**Agent:** Terra xhigh.
**Depends on:** Tasks 5B and 7A; rebase after Task 6A main edits.
**Issue:** #629.

**Files:**

- Create: `electron/audio/streamingAecCoordinator.ts`
- Create: `tests/unit/streamingAecCoordinator.test.ts`
- Modify: `electron/main.ts`
- Modify narrowly: `electron/captureJournal.ts` observer/resolver.

- [ ] **Step 1: Write RED pairing/lifecycle tests**

The main-process journal observer pairs durable mic/System receipts by capture generation, sequence, and bounds. It sends approved absolute WAV paths to the native runtime. The runtime writes a temporary output under the meeting artifact root; coordinator verifies type, containment, checksum, and atomically activates it.

- [ ] **Step 2: Implement bounded processing**

One active plus one queued interval. Timeout, missing pair, weak reference, worker exit, sequence gap, or owner destruction writes an untrusted sidecar and releases all process/buffer state.

- [ ] **Step 3: Add `AEC_DRAIN` contract**

`AUDIO_CAPTURE_JOURNAL_AEC_DRAIN_ATTACH` waits to an admitted capture watermark, persists trusted/untrusted result for every admitted mic interval, attaches sidecars through the renderer's serialized mutation, and returns a finite watermark. It never silently omits a failed interval.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/streamingAecCoordinator.test.ts \
  tests/unit/captureSessionOwnershipBoundary.test.ts \
  tests/unit/captureJournalSealBoundary.test.ts
pnpm exec tsc --noEmit
git diff --check
git add electron/audio/streamingAecCoordinator.ts electron/main.ts \
  electron/captureJournal.ts tests/unit/streamingAecCoordinator.test.ts \
  tests/unit/captureSessionOwnershipBoundary.test.ts \
  tests/unit/captureJournalSealBoundary.test.ts
git commit -m "feat(audio): coordinate trusted rolling AEC (#629)"
```

---

## Task 7C: Gate AEC before dual-source shadow

**Agent:** Luna medium executes; Terra high decides.
**Depends on:** Task 7B.

- [ ] **Step 1: Run frozen synthetic gates and packaged-runtime lifecycle**

System-only fixture must also yield zero `Me` segments after production transcription/reconciliation.

- [ ] **Step 2: Run one bounded recent-meeting diagnostic**

Recent meeting evidence may measure receipt integrity, pre/post correlation, confidence, resources, and reconciled proxy non-regression. It may not claim SI-SDR/local attenuation without known ground truth.

- [ ] **Step 3: Stop immediately if AEC is unavailable or weak**

Do not polish later replay stages. Keep MLX primary and full finalization unchanged.

---

## Task 8A: Add dual-source Parakeet shadow

**Agent:** Terra high.
**Depends on:** Tasks 3, 4A, 6B, and 7C.
**Issue:** #630.

**Files:**

- Modify: `electron/transcription/parakeetLiveMeetingCoordinator.ts`
- Modify: `electron/main.ts`
- Modify: `scripts/validate_private_parakeet_live_manifest.ts`
- Modify: `scripts/run_private_parakeet_live_replay.ts`
- Modify: `tests/unit/privateParakeetLiveManifest.test.ts`
- Modify: `tests/unit/privateParakeetLiveOrchestration.test.ts`
- Modify: `tests/unit/parakeetLiveMeetingCoordinator.test.ts`

- [ ] **Step 1: Write RED trusted-mic tests**

Open System plus mic only when the mic interval has a trusted AEC receipt. Sequence mapping and source/generation identity are exact. Untrusted AEC mid-meeting triggers coordinator failure for primary eligibility; shadow may continue System-only only while it remains invisible.

- [ ] **Step 2: Bind replay inputs to AEC receipts**

Update the private manifest/runner adapter to accept receipt-bound residual mic paths and AEC evidence. Engine-isolated MLX-vs-Parakeet comparison uses identical cleaned inputs; end-to-end workflow comparison remains separate.

- [ ] **Step 3: Verify and commit**

```bash
pnpm exec vitest run \
  tests/unit/parakeetLiveMeetingCoordinator.test.ts \
  tests/unit/privateParakeetLiveManifest.test.ts \
  tests/unit/privateParakeetLiveOrchestration.test.ts \
  tests/unit/streamingAecCoordinator.test.ts
pnpm exec tsc --noEmit
git diff --check
git add electron/transcription/parakeetLiveMeetingCoordinator.ts electron/main.ts \
  scripts/validate_private_parakeet_live_manifest.ts \
  scripts/run_private_parakeet_live_replay.ts \
  tests/unit/privateParakeetLiveManifest.test.ts \
  tests/unit/privateParakeetLiveOrchestration.test.ts \
  tests/unit/parakeetLiveMeetingCoordinator.test.ts
git commit -m "feat(transcription): add dual-source Parakeet shadow (#630)"
```

### Task 8A gate: prove dual-shadow operation before visible integration

Run at least three internal dual-shadow sessions totaling 90 minutes, including one >=30 minutes. Require trusted receipt coverage, no source cross-talk, no prefix mutation, exact cleanup, and all Task 9 memory/thermal/latency gates. Publish only content-free evidence plus an implementation/config digest. Task 8B is blocked until this gate passes.

---

## Task 8B: Add renderer IPC and visible Parakeet projection

**Agent:** Terra xhigh.
**Depends on:** Task 8A dual-shadow gate.
**Issue:** #630.

**Files:**

- Create: `src/services/liveTranscription/liveTranscriptBridge.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify only if failing tests require: `src/App.tsx`, `src/components/features/LiveTranscript.tsx`
- Modify: `electron/main.ts`
- Create: `tests/unit/parakeetLiveRecordingIntegration.test.ts`
- Modify relevant DOM tests.

- [ ] **Step 1: Define exact IPC**

```ts
type ParakeetLiveRendererEvent = {
  meetingId: string;
  captureGeneration: string;
  engineEpoch: number;
  mode: 'parakeet_primary' | 'mlx';
  source: 'mic' | 'system';
  parakeetGeneration: number;
  revision: number;
  committedPreviewText: string;
  tentativeText: string;
  audioEndSeconds: number;
};
```

Use explicit channels `PARAKEET_LIVE_STATE_EVENT` and `PARAKEET_LIVE_FAILURE_EVENT`. Register/remove listeners by meeting owner and fence meeting/generation/epoch. Diagnostics exclude text even though the UI event intentionally carries text.

- [ ] **Step 2: Keep `AudioManager` bridge thin**

It starts/stops the meeting live session and consumes projected events. It does not forward raw receipts, run AEC/ASR, or own native lifecycle.

- [ ] **Step 3: Verify stable UI behavior**

Shadow never publishes. Primary displays committed/tentative projection as `Refining live`; older committed preview cannot mutate. Modify `LiveTranscript.tsx` only if a failing DOM test proves necessary.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run tests/unit/parakeetLiveRecordingIntegration.test.ts
pnpm exec tsc --noEmit
git diff --check
git add src/services/liveTranscription/liveTranscriptBridge.ts \
  src/components/AudioManager.tsx electron/main.ts \
  tests/unit/parakeetLiveRecordingIntegration.test.ts
git commit -m "feat(transcription): project Parakeet live preview (#630)"
```

---

## Task 8C: Integrate one-way MLX fallback with separate cancellation scopes

**Agent:** Terra xhigh.
**Depends on:** Tasks 3 and 8B.

**Files:**

- Modify: `src/components/AudioManager.tsx`
- Modify: `electron/main.ts`
- Modify: fallback/state/integration tests.

- [ ] **Step 1: Replace broad cancellation with scoped handlers**

Define separate operations:

```text
CANCEL_MLX_LIVE_PREVIEW
PARAKEET_LIVE_DRAIN
PARAKEET_LIVE_CANCEL
FINAL_TRANSCRIPTION_CANCEL
```

Do not reuse broad `CANCEL_MEETING_TRANSCRIPTION` for live stop ordering.

- [ ] **Step 2: Prove the receipt splice**

Fence Parakeet, retain committed preview, discard tentative tail, compute first MLX receipt, and prove zero gap/duplicate coverage at the boundary. If memory requires, fully unload live Parakeet before starting MLX.

- [ ] **Step 3: Verify and commit**

```bash
pnpm exec vitest run tests/unit/liveEngineStateMachine.test.ts \
  tests/unit/parakeetLiveRecordingIntegration.test.ts
pnpm exec tsc --noEmit
git diff --check
git add src/components/AudioManager.tsx electron/main.ts \
  tests/unit/liveEngineStateMachine.test.ts \
  tests/unit/parakeetLiveRecordingIntegration.test.ts
git commit -m "feat(transcription): add one-way MLX fallback (#630)"
```

---

## Task 8D: Implement exact stop/finalization ordering

**Agent:** Terra xhigh.
**Depends on:** Tasks 7B, 8A-C.
**Parallel:** No other integration edits.

**Files:**

- Modify: `src/components/AudioManager.tsx`
- Modify: `electron/main.ts`
- Modify: `tests/unit/recordingStopBoundary.test.ts`
- Modify: `tests/unit/captureJournalSealBoundary.test.ts`
- Modify: finalization/analysis integration tests.

- [ ] **Step 1: Write RED ordering tests**

Exact stop sequence:

1. stop capture and admit the final MediaRecorder interval;
2. drain raw journal writes;
3. transition the journal exactly once to `stopping`, durably fixing mic/System source watermarks;
4. allow verified `AUDIO_CAPTURE_JOURNAL_AEC_DRAIN_ATTACH` mutations while `stopping`, drain through the fixed source watermarks, and mark every admitted mic interval trusted or untrusted;
5. durably fix the AEC evidence watermark, including the last capture sequence and trusted/untrusted status for every admitted mic interval;
6. drain/flush Parakeet only through those fixed source/AEC watermarks;
7. fence late events;
8. call `AUDIO_CAPTURE_JOURNAL_SEAL` exactly once;
9. save provisional transcript;
10. run the existing full-session final path available on the landed branch;
11. commit canonical transcript;
12. start analysis from that exact commit.

- [ ] **Step 2: Keep full finalization**

Do not remove the routine final pass in #630. If #628 has not landed, preserve current master final behavior and keep Parakeet primary behind an off flag.

- [ ] **Step 3: Run full integration verification and commit**

```bash
pnpm exec vitest run tests/unit/recordingStopBoundary.test.ts \
  tests/unit/captureJournalSealBoundary.test.ts \
  tests/unit/parakeetLiveRecordingIntegration.test.ts
pnpm test
swift test --package-path native/parakeet-runtime
pnpm exec tsc --noEmit
pnpm run changelog:check
git diff --check
git add src/components/AudioManager.tsx electron/main.ts \
  tests/unit/recordingStopBoundary.test.ts \
  tests/unit/captureJournalSealBoundary.test.ts \
  tests/unit/parakeetLiveRecordingIntegration.test.ts
git commit -m "feat(transcription): order live stop and finalization (#630)"
```

---

## Task 9: Run staged evaluation and rollout

**Agent:** Luna medium runs commands/reports; Terra high makes go/no-go decisions.
**Depends on:** Tasks 4A/B, 5B, 6B, 7C, and 8D.
**Model execution:** Strictly sequential during comparisons.

- [ ] **Stage 1: One-meeting preflight**

Run MLX, pinned default, and low-latency Parakeet sequentially for one eligible recent meeting and one repetition using AEC-cleaned inputs. Emit a content-free selection artifact. Stop if neither Parakeet config passes.

```bash
pnpm run replay:parakeet-live -- --stage preflight --repetitions 1 \
  --selection "$SELECTION_PATH" --manifest "$PRIVATE_MANIFEST"
```

- [ ] **Stage 2: Winner-only promotion replay**

Run only the selected config versus MLX over three eligible meetings totaling >= 90 minutes, three alternating repetitions.

```bash
pnpm run replay:parakeet-live -- --stage promotion --config "$WINNER" \
  --repetitions 3 --selection "$SELECTION_PATH" --manifest "$PRIVATE_MANIFEST"
```

- [ ] **Stage 3: Winner-only real-time soak**

Run only the winner on the longest meeting. The independent probe samples while inference blocks.

```bash
pnpm run replay:parakeet-live -- --stage realtime-soak --config "$WINNER" \
  --selection "$SELECTION_PATH" --manifest "$PRIVATE_MANIFEST"
```

- [ ] **Stage 4: Internal shadow and primary gates**

Minimums:

| Stage | Minimum evidence | Visible behavior |
|---|---|---|
| System shadow | 3 sessions / 60 min, one >=30 min | MLX only |
| Dual AEC shadow | 3 sessions / 90 min, one >=30 min | MLX only |
| Internal primary | 5 sessions / 120 min | Parakeet + MLX fallback |
| Canary | 10 sessions / 300 min | Parakeet + immediate rollback |

Feature flag state is persisted. Any watchdog violation immediately unloads Parakeet for the meeting, records a finite rollback counter, and leaves MLX/current finalization active.

Reuse the Task 6B system-shadow gate and Task 8A dual-shadow gate only when their implementation, model, FluidAudio, AEC algorithm/config, threshold, and corpus digests exactly match the candidate. Any relevant change invalidates only the affected downstream evidence; do not rerun expensive stages when the bound digest is unchanged.

- [ ] **Apply frozen gates**

Five-second durable input makes sub-five-second cadence structurally impossible. Use:

- first text p50 <= 7 s, p95 <= 10 s, max <= 12 s;
- active-speech cadence median <= 5.5 s, p95 <= 7 s, max <= 8 s;
- processing latency after durable availability p95 <= 2 s, max <= 5 s;
- RTF <= 0.50 and <= 1.2x MLX;
- capture handoff p99 <= 10 ms;
- zero committed-prefix mutations;
- exact receipt/sealed coverage;
- zero `Me` segments for System-only synthetic fixtures;
- seam duplicate/omission <= 0.5%, zero on committed synthetic cases;
- Parakeet disagreement <= MLX + 0.02;
- aligned recall no more than 0.02 below MLX;
- streaming-vs-batch diagnostic edit rate <= 0.10;
- Parakeet child RSS <= 2.5 GiB;
- combined shadow RSS <= 4.5 GiB;
- post-warmup growth <= 64 MiB/hour;
- no serious/critical thermal state; fair <=10% and <=5 continuous minutes.

- [ ] **Stop immediately on any hard failure**

AEC unavailable/weak, raw mic in primary, prefix edit, receipt/coverage error, uncertain cleanup, memory/thermal watchdog, latency max, reconciled proxy/batch regression, or repair outside its window ends the stage. Do not polish later stages.

- [ ] **Record a truthful decision**

ADR language is limited to `engineering fit supported`, `non-regression supported`, `failed`, or `unavailable`. Do not claim superior lexical accuracy without ground truth. Do not request another human review.

---

## Follow-up: Conditional finalization is not part of #630 completion

Create a separate issue/plan only after canary success. The spike asks whether continuous FluidAudio can expose exact monotonic timed words with source, generation, revision, and receipt provenance.

If supported, plan `reuse_stream | targeted_repair | full_batch` canonical finalization while preserving lease -> validation -> DB commit -> analysis ordering.

If only untimed text/audio watermarks are available, record `timed_live_words_unavailable`, keep the full final pass, replace any initial RED viability test with a passing unsupported-capability test, and stop. Never fabricate timing.

---

## 4. Verification after every integration wave

```bash
swift test --package-path native/parakeet-runtime
pnpm exec vitest run \
  tests/unit/liveTranscriptionStablePrefix.test.ts \
  tests/unit/parakeetLiveClient.test.ts \
  tests/unit/liveTranscriptionReplayMetrics.test.ts
pnpm exec tsc --noEmit
pnpm run changelog:check
git diff --check
```

Run `pnpm test` before marking any PR ready. Use scoped Biome checks for application code; the vendored FluidAudio JSON formatting exception is not a reason to rewrite vendor assets.

## 5. Global abort conditions

Stop and return to the last approved mode when:

- combined memory approaches the prior freeze mode or any child cannot be proven exited;
- live/final Parakeet inference overlaps;
- AEC is missing, weak, clipped, mismatched, or damages synthetic local-only speech;
- raw mic reaches primary local-speaker evidence;
- DSP/inference runs on renderer or capture callback;
- receipt sequence/checksum/generation/bounds or sealed coverage is uncertain;
- tentative text mutates committed history;
- a shadow mode alters visible/canonical state;
- analysis starts before canonical commit;
- an agent proposes removing MLX/full finalization before its explicit follow-up gate;
- any spec or quality reviewer has an unresolved Important issue.

## 6. Definition of done for #630/#629 primary rollout

1. One AEC backend passes frozen synthetic gates and is packaged offline.
2. Rolling AEC persists trusted/untrusted receipt-bound evidence without changing raw capture.
3. One exclusive Parakeet runtime consumes System plus only trusted residual mic receipts.
4. System/dual shadow pass lifecycle, memory, coverage, and AEC gates without visible changes.
5. Primary publishes stable preview and falls back once to MLX with zero receipt gap/duplication.
6. Stop ordering drains raw/AEC/live work, seals evidence, retains full finalization, commits canonical state, then starts analysis.
7. Staged recent-meeting replay, real-time soak, internal primary, and canary pass frozen gates.
8. #629/#630 issues, ADR, developer docs, changelog fragment, plan checkboxes, and PR traceability are current.
9. Conditional finalization is explicitly deferred to its own issue and does not block this definition of done.
