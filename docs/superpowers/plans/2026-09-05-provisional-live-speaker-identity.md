# Provisional Live Speaker Identity: Feasibility and Gated Implementation Plan

**Issue:** [#770](https://github.com/metagrover/pluto/issues/770)
**Status:** Phase A is executable; named live identity is held behind feasibility and quality gates.
**Baseline:** Verified product source at `origin/master` `f7aa680824ff7b84ae3c9975786e200aeed77ddf` on 2026-09-05. The graph indexes a separate voice-profile branch; its unmerged repairs are not assumed delivered.
**Priority:** Reliable capture/transcripts and accurate attribution before automatic names. A missed suggestion is acceptable; a false name is not.

## Scope challenge and sequencing decision

Deliver stable live reading (#670) independently. Run a bounded native feasibility experiment before implementing a production rolling-analysis lane, new IPC, settings, or live confirmation UI. Asynchronous Swift syntax does not prove EOU isolation, and offline cluster IDs do not establish identity continuity across rolling windows.

Rebase production work onto delivered #755/#768 voice-profile fixes and re-read their actual contracts. Current master has post-meeting enrollment/matching code, but that does not prove clean-chunk aggregation, privacy/lifecycle behavior or calibration are production-ready. Do not duplicate or prematurely depend on concurrent repairs.

Phase A answers whether useful speaker evidence can be produced within a declared CPU/memory/latency budget without degrading EOU, and whether it can be associated with the exact displayed speech. A failed experiment is a valid result: keep live labels anonymous and #770 open with the failing gate recorded. Do not ship a large dormant implementation merely because the code compiles.

## What already exists

| Seam | Verified behavior and implication |
| --- | --- |
| `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetEouSession.swift:92` | An actor holds one manager per mic/System source; append awaits that source's manager and guards in-flight state. Add-on work must not execute expensive synchronous work on this actor. |
| `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift:202` | SpeakerEvidenceCoordinator analyzes mic/System file URLs, not a rolling PCM window API. It runs energy analysis, offline System diarization and cluster aggregation. An in-memory adapter is work to prove, not an existing method. |
| `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift:298` | FluidAudioOfflineDiarizer owns a prepared offline manager and processes an audio URL. No verified cross-window identity contract is implied by its speakerId. |
| `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift:211` | RuntimeRequestCoordinator already dispatches detached request tasks and serializes delivery. Reuse cancellation/writer ownership; do not invent a second unbounded task dispatcher. |
| `electron/transcription/parakeetRuntimeHost.ts:86` | Shared native process has exclusive live/final lease admission. Calling the final speaker-evidence client during live capture would not create a free concurrent lane. Do not bypass leasing in product code. |
| `electron/transcription/parakeetEouClient.ts:228` | Only eou_update/eou_failed advance the EOU event sequence. A future optional analysis event needs a separate revision domain. |
| `electron/transcription/nativeJsonLineProcess.ts:148` | 16 MiB transport buffer limit and strict event parser. A malformed event currently fails the process; optional payload validation must not silently weaken core protocol handling. |
| `electron/transcription/parakeetFinalClient.ts:576` | Existing cluster-evidence validator checks array bounds and 256-dimensional finite embeddings. Reuse validated shape/purity policy, but do not expose final-client result payloads to React. |
| `src/services/speakerCandidateEvidence.ts:163` | deriveSpeakerCandidates needs established cluster labels and transcript sample intervals. These post-meeting inputs cannot be fabricated from a rolling cluster ID. Reuse only evidence/compatibility/purity primitives where their assumptions hold. |
| `src/services/speakerVoiceMatcher.ts:98` | Matcher checks opt-in, purity, exact provenance, active profiles and runner-up margin; rejection identity includes source revision and digest. Existing numeric policy is not a validated live-window calibration. |
| `electron/commitmentIdentity.ts:15` | Canonical source revision is a hash of persisted transcript_json and turns come from that transcript. |
| `electron/identityHandlers.ts:271` | Binding requires the speaker to exist in persisted turns, then writes its source revision and queues identity effects. A live cluster cannot safely call this path. |
| `electron/speakerVoiceHandlers.ts:118` | Enrollment resolves a stored revision/digest-bound candidate. Live hints must never create candidates/enrollments to satisfy this precondition. |
| `electron/main.ts:3522` | GET_SETTING/SET_SETTING already exist. Future live opt-in uses a separate setting, not new generic settings IPC. |

Evidence used graph Verify tier, project `Users-metagrover-Desktop-pluto`, generation `2026-09-05T23:05:24Z`, with no recorded gaps for checked candidate paths. The graph's voice-branch source differs; direct worktree reads and the empty product diff against the pinned master are ground truth.

Freshness note: `origin/master` advanced to `44985401eca906f61ee47801ee8010aabb814393` during review, including voice-profile changes. Statements above describe the pinned snapshot, not the newly delivered tree. Rebase and verify those repairs before A2 quality claims or any Phase B implementation; do not duplicate the concurrent work.

## Trust boundary and data flow

```text
CURRENT, AUTHORITATIVE:
PCM -> EOU -> #670 reading view                  stop -> sealed final ASR
            You / Call                                   |
                                               validated anonymous speakers
                                                         |
                                               explicit Speaker Review
                                                         |
                                               binding / opted-in enrollment

PHASE A, PRIVATE TEST HARNESS ONLY:
time-aligned mic/System slices -> offline evidence -> candidate-quality metrics
       \-> concurrent EOU replay ---------------------> latency/queue comparison
                    no named renderer events, no canonical writes

FUTURE, ONLY AFTER GATES:
native bounded snapshot -> optional worker -> valid scoped evidence
                                             |
                               main: profile policy + interval matching
                                             |
                               sanitized expiring suggested labels
                                             |
                                    #670 label decoration only
```

Embeddings remain in the existing native/main trusted local boundary. No biometric vectors, scores, digests, audio paths or model internals enter renderer IPC, logs, analytics, screenshots or committed fixtures. Consented benchmark raw data stays local and untracked. Reports allow only aggregate counts/durations and failure categories. Never use names, words or calendar attendees to guess an acoustic identity.

Names must not affect ASR text, ranges, row IDs/order, scroll anchors, context ingestion, notes, commitments, or People evidence. You/Call remain fully usable with the feature absent, disabled or failing.

## Phase A: executable feasibility work

- [ ] **A1 (P1, human: 0.5–1 day / agent: 1–3 hours): Define the experiment before running it.** Create `docs/qa/live-speaker-identity-feasibility.md`, `scripts/validate_private_live_speaker_identity_manifest.ts`, and `tests/unit/privateLiveSpeakerIdentityManifest.test.ts`. Record pinned runtime/model/provenance, hardware/OS class, enrollment policy revision, consented corpus taxonomy, held-out evaluation split and metric allowlist. Reuse the structure of `scripts/validate_private_parakeet_eou_manifest.ts`; add `benchmark:private-live-speaker-identity:validate` to `package.json`. Missing private data is explicit NOT RUN and cannot satisfy any gate.
- [ ] **A2 (P1, human: 1–2 days / agent: 3–6 hours): Establish offline candidate usefulness.** Create `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/LiveSpeakerEvidenceFeasibilityTests.swift` and `tests/manual/liveSpeakerIdentityFeasibility.test.ts`. Exercise existing SpeakerEvidenceCoordinator on private synchronized slices and synthetic test drivers. Quantify eligible clean chunks/segments/duration, unknown-speaker errors, overlap exclusions, boundary instability and cluster splits/merges. Repeated overlapping snapshots of the same audio are one evidence exposure, not independent confirmations. Reuse delivered candidate/purity fixes; do not copy thresholds or assume an aggregate Them cluster is one person.
- [ ] **A3 (P1, human: 1–2 days / agent: 3–6 hours plus real-time replay): Measure concurrent cost.** Create `scripts/run_live_speaker_identity_benchmark.ts` and `tests/unit/liveSpeakerIdentityBenchmark.test.ts`; extend the native feasibility test to drive EOU and analysis against the same native service/model resources. Read `ParakeetService.swift`, `RuntimeJSONLineRouter.swift`, and `ParakeetEouSession.swift` before choosing the smallest harness seam. A mock scheduler proves control flow only; actual FluidAudio + EOU replay proves resource contention. The harness must not enable analysis in normal recording or bypass product runtime admission.
- [ ] **A4 (P1, human: 0.5 day / agent: 1–2 hours): Record a pass/hold verdict and freeze the next contract.** Compare baseline and concurrent runs on identical audio/hardware with cold/warm models and long-session/pressure cases. Record only aggregates and failure categories in the QA document. If all gates pass, update this plan with the measured scheduling/buffer/cadence limits, capability negotiation design, exact supported interval mapping and versioned live calibration policy before Phase B. If not, retain anonymous live labels and the final Speaker Review flow.

The previously proposed 45-second window, 12-second cadence, 16 clusters, 64 intervals and two consecutive revisions are **experiment candidates**, not existing limits or approved quality thresholds. Search a bounded set of window/cadence options and select using evidence. Specify numerical latency/memory acceptance budgets before examining held-out results, based on baseline/hardware constraints; never tune acceptance retrospectively to fit a run.

The current file-URL API permits a private feasibility harness using bounded temporary slices. Give test-owned files restrictive permissions, explicit lifetime and cleanup after completion/cancellation; do not reuse growing capture files as stable snapshots. This does not establish a production PCM API. Phase A must choose either a supported bounded PCM adapter or an explicitly budgeted transient-file implementation before declaring integration feasible.

## Feasibility and quality gates

| Gate | Required result |
| --- | --- |
| Capture and EOU isolation | No added frame loss, prefix mutation, sequence error, source coverage loss or analysis-caused EOU failure; queue never exceeds the existing four outstanding per source; no worse p95 beyond the predeclared tolerance. |
| Scheduling | At most one analysis per meeting, bounded latest-work coalescing, cancellation/expiry invalidates results, and no unbounded queue or synchronous capture-path work. |
| Shared resources | Measured model preparation, CPU/ANE pressure, native RSS, buffer/copy bytes, analysis p50/p95 and stop latency stay within predeclared budgets. Actor separation alone is insufficient. |
| Clock correctness | Convert each source's local clock to meeting time, preserve source start offsets/sample rate changes and gaps, and exclude intervals not represented by synchronized evidence. |
| Candidate validity | Clean evidence has correct original-audio provenance; overlapping snapshots do not double-count duration/chunks; incompatible policy or unavailable clean evidence gives no suggestion. |
| Speaker association | A new/split/merged/reassigned cluster never inherits a previous name by numeric ID. Only explicitly supported clean intervals may be named. |
| Precision and usefulness | Zero observed false named suggestions on held-out positive and negative cases; report denominators, coverage, misses, time-to-first-suggestion and confidence limits. Zero suggestions is not a useful pass. |
| Failure/lifecycle | Missing model, silence, invalid optional aggregate, timeout, stop, reset, owner destruction and profile mutation suppress suggestions while preserving ordinary EOU/canonical work. |

Use the voice-profile design's baseline corpus floor: at least five enrolled speakers across three conference applications and three separate meetings per enrolled speaker, with held-out meetings and unenrolled/similar-voice negatives. Add speaker handoffs within a System row, genuine overlap, loudspeaker bleed, headphones, device reconnect, profile disable/delete/merge/restore, stale/incompatible policy and runtime failures. Freeze the exact minimum useful suggestion coverage and latency criteria before evaluation. Zero observed false suggestions is a bounded empirical result, not a proof of zero population error.

## Phase B: conditional implementation tasks

These tasks are intentionally gated by A4, not authorized evidence claims. Refresh exact files against the delivered #670 and voice-profile branches first. No live confirmation/enrollment transaction is included.

- [ ] **B1 (P1, human: 2–4 days / agent: 4–8 hours): Add the measured optional analysis lane and negotiated protocol.** Likely seams: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift`, `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetEouSession.swift`, `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`, `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/RuntimeJSONLineRouter.swift`, `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`, `native/parakeet-runtime/Sources/ParakeetRuntimeCore/LiveProtocol.swift`, and `native/parakeet-runtime/Sources/ParakeetRuntime/main.swift`. Add at most one bounded session-owned worker only if A4 demonstrates the need. Admission/completion must recheck meeting generation, snapshot interval and profile/policy revision. Use a distinct analysis revision, never consume EOU sequence numbers. A capability handshake must ensure old clients never receive unknown events. If its exact additive form cannot preserve old-core behavior, stop integration and document the compatibility change for review.
- [ ] **B2 (P1, human: 1–2 days / agent: 3–6 hours): Validate and sanitize in main.** Modify `electron/transcription/nativeJsonLineProcess.ts`, `electron/transcription/parakeetEouClient.ts`, `electron/transcription/parakeetEouMeetingCoordinator.ts`, and `electron/main.ts`; create `electron/transcription/liveSpeakerIdentityCoordinator.ts` with `tests/unit/liveSpeakerIdentityCoordinator.test.ts`. Extract only compatible validated shared candidate primitives, not post-meeting transcript/canonical-label assumptions. Reuse `src/services/speakerVoiceMatcher.ts` with an explicit live-calibrated policy. Optional malformed evidence should be rejected before emission; parser tests must distinguish a structurally invalid core envelope (existing terminal failure) from a negotiated, well-formed optional failure/no-evidence status (anonymous fallback). Never relax global protocol validation to keep names alive.
- [ ] **B3 (P1, human: 1–2 days / agent: 3–6 hours): Own label stability and revocation in main.** Keep bounded ephemeral interval evidence and profile/policy versions. Count only newly observed compatible clean audio toward hysteresis. Re-evaluate split/merge/overlap; unknown or conflicting intervals return to Call. Missing updates retain a label only until its declared evidence expiry; they cannot leave a name indefinitely. Stop, reset, owner loss, feature disable, person/profile delete/disable/merge/restore and knowledge reset immediately revoke applicable hints, including already displayed labels. A session-level `Not this person` action prevents the same person resurfacing under a new digest/cluster; do not persist fake canonical rejection rows.
- [ ] **B4 (P1, human: 1 day / agent: 2–4 hours): Add minimal renderer hints.** Create `src/services/liveTranscription/liveSpeakerIdentityContract.ts`, `src/api/liveSpeakerIdentity.ts`, `tests/unit/liveSpeakerIdentityContract.test.ts`, and `tests/unit/liveSpeakerIdentityApi.test.ts`. Proposed sanitized envelope: meeting ID, generation, monotonic hint revision, opaque suggestion ID, display label, explicit supported intervals and expiry/revocation state. Strictly reject unknown keys, invalid times/counts, unsupported source and oversized strings; derive final bounds from A4. The source is System only. Renderer receives no embedding, score, digest, audio path, person ID or transcript excerpt.
- [ ] **B5 (P1, human: 1 day / agent: 2–4 hours): Decorate exact speech without grouping changes.** Modify `src/components/AudioManager.tsx`, `src/App.tsx`, `src/components/features/ZenMode.tsx`, `src/components/features/LiveTranscript.tsx`, and `tests/unit/LiveTranscript.dom.test.tsx`. Use the #670 source-owned ranges. A Call row may contain multiple people: decorate only wholly supported homogeneous parts, otherwise leave its label Call. Mere temporal overlap is insufficient. Show `Likely Alex` as a suggestion with keyboard-operable rejection and `Review after meeting`; no automatic modal, focus steal, body live-region, or text/order changes.
- [ ] **B6 (P1, human: 1–2 days / agent: 2–4 hours plus real-time QA): Roll out independently.** Add separate proposed setting `voice_profile_live_suggestions_v1`, default false, via existing settings. Read it before native analysis admission; disabled mode allocates no worker/buffer and performs no profile lookup. Retain runtime disable/revocation. Update `docs/qa/live-speaker-identity-feasibility.md`, create `docs/changelog/entries/2026-09-05-provisional-live-speaker-identity.md`, and record an enabled policy in `docs/decisions.md` only after release gates. Build/package the changed native binary with existing scripts and verify fresh-app/old-binary capability behavior. Repeat real recording, stop, finalization and notes acceptance with feature on/off.

Use Swift concurrency primitives already present; detached work still competes for resources, and cancellation requires cooperation. Recheck state after suspension points. [Swift concurrency guidance](https://docs.swift.org/swift-book/LanguageGuide/Concurrency.html).

## Identity state and confirmation boundary

```text
disabled / no valid policy -> Call
valid clean new evidence  -> anonymous pending evidence
enough calibrated support -> Likely person (covered intervals only)
same underlying audio     -> no extra independent evidence credit
conflict / split / expiry -> Call
profile mutation / reset  -> revoke all affected hints
user rejects person       -> Call + session denial
stop                      -> discard live hints
validated final speakers  -> separate explicit Speaker Review -> binding
```

There is no bare confirmed live name in this release. Canonical bindings require a speaker in persisted transcript_json and its source revision. Ephemeral rolling cluster numbers cannot become canonical Remote Speaker N. Even explicit live confirmation could incorrectly name later speech if a cluster changes. A future live-confirmation design must prove interval-to-final-speaker mapping and stale/revision handling; it must not silently write bindings, enroll voiceprints or create People evidence.

## NOT in scope

- Named live identity before A4; a production analysis worker is not the feasibility experiment.
- Enrollment from live audio or automatic named canonical speakers; continue explicit post-meeting review/opt-in.
- Calendar-to-speaker guesses, ASR word-based identity, treating aggregate Them as one person, or cross-window cluster IDs as stable people.
- Replacing post-meeting voice stores/calibration or fixing concurrent #768 work in this branch; those are prerequisite deliveries.
- Forwarding the existing post-meeting suggestion result directly to React: it currently includes fields excluded from this narrower live contract.
- Persistent live suggestion/rejection tables, new model downloads on the capture hot path, or relaxed native transport limits.
- A separate unbounded PCM archive or relying on a final lease during recording.
- Any changes to transcript text, source range membership, notes, commitments or People from automatic live hints.

## Tests, realistic failures and coverage

```text
Phase A:
private manifest -> missing/invalid/consented     validator unit + explicit NOT RUN
synchronized slices -> clean/overlap/unknown     native + held-out private evaluation
concurrent EOU -> warm/cold/slow/cancel/pressure  actual-runtime causal benchmark

Phase B, only after gate:
capability absent -> no analysis                 core protocol + old/new fixture tests
optional evidence -> valid / no-evidence / bad   native parser + main integration
identity -> new audio / replay / conflict        coordinator unit tests
profile mutation -> revoke while idle/in-flight  lifecycle integration
interval -> homogeneous / boundary / mixed row   contract + DOM tests
reject -> changed digest still suppressed        coordinator + API tests
stop/reset -> no late hints; canonical still runs EOU/final integration + Electron
```

| Failure | Handling / user outcome | Required test |
| --- | --- | --- |
| Analysis competes with EOU/ANE or model preparation | Abort admission/disable names; capture and live text remain primary | A3 real contention, B1 lifecycle |
| Offline API cannot meet memory/latency budgets | Hold Phase B; no names shipped | A4 recorded gate |
| Rolling speaker IDs split/merge or reused audio matches twice | No inherited identity or double-counted confidence | A2/B3 continuity tests |
| Mic/System start offsets differ or reconnect resets clocks | Exclude unsynchronized intervals; Call | A2/B1 offset/reset fixtures |
| One row contains two remote speakers | No row-wide name from partial overlap | B5 multi-speaker DOM |
| Bad aggregate / typed no speech / core malformed event | Optional candidate unavailable; core protocol failure remains fail-closed | Native/core + TS parser tests |
| Silence prevents subsequent hint updates | Expiry revokes stale names without requiring new speech | B3 clock-driven test |
| Profile disabled/deleted/merged during matching | Revision check drops result and revokes displayed hint | B3 integration |
| Rejection followed by new cluster/digest | Session person denial prevents re-suggestion | B3/B4 |
| Stop or owner loss while worker runs | Cancel/drop buffers and late outputs; release for finalization | B1 native + EOU coordinator |
| Old bundled binary lacks capability | Feature stays anonymous; normal EOU remains usable | B1 packaged compatibility |
| Private benchmark absent or zero eligible suggestions | No quality pass, explicit missing/usability failure | A1/A4/B6 |

Existing test anchors: `tests/unit/nativeJsonLineProcess.test.ts`, `tests/unit/parakeetEouClient.test.ts`, `tests/unit/parakeetEouMeetingCoordinator.test.ts`, `tests/unit/parakeetRuntimeHost.test.ts`, `tests/unit/speakerCandidateEvidence.test.ts`, `tests/unit/speakerVoiceMatcher.test.ts`, `tests/unit/speakerVoiceHandlers.test.ts`, `tests/unit/speakerVoiceStore.test.ts`, `tests/unit/identityHandlers.test.ts`, `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/EouProtocolTests.swift`, `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetEouSessionTests.swift`, and `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`. The EOU session suite, not the older ParakeetLiveSession suite, is the primary live-ASR regression target. New tests above are requirements, not existing proof.

## Dependency and parallelization strategy

| Workstream | Modules | Depends on |
| --- | --- | --- |
| #670 | renderer reading/transcript | Independent delivery |
| #768 repair delivery | voice evidence/store/matching | Separate owner; verify delivered commit |
| A1 corpus contract | scripts/tests/docs | Neither feature implementation |
| A2/A3 experiment | native test harness/scripts | A1; use actual voice fix baseline for quality claims |
| A4 go/hold | docs/qa/plan | A2/A3 |
| B1/B2 transport | native/Electron transcription | A4, delivered voice fixes |
| B3/B4 policy/IPC | Electron identity, src/api | B1/B2 |
| B5/B6 UI/rollout | renderer, packaging/QA | delivered #670 and B1–B4 |

A1 corpus preparation may run alongside independent #670/#768 work. Native experimentation must not change their production modules. B1/B2 share a wire contract and should land sequentially or as one coordinated PR; B3–B6 follow. Never parallelize competing edits to AudioManager, SpeakerEvidence.swift or voice stores without explicit file ownership.

## Validation and definition of done

Phase A runs focused tests without claiming product completion:

```bash
pnpm vitest run tests/unit/privateLiveSpeakerIdentityManifest.test.ts tests/unit/liveSpeakerIdentityBenchmark.test.ts
swift test --package-path native/parakeet-runtime --filter LiveSpeakerEvidenceFeasibilityTests
swift test --package-path native/parakeet-runtime --filter ParakeetEouSessionTests
swift test --package-path native/parakeet-runtime --filter FluidAudioSpeakerEvidenceTests
pnpm run benchmark:private-live-speaker-identity:validate
```

A1 must define and document the explicit private-manifest/environment command for the new manual harness before A2 runs it; no private file path is committed. Unconfigured runs must be marked NOT RUN. Phase B additionally runs all changed named suites, TypeScript, lint, changelog checks, full tests and `pnpm run build-native`, followed by fresh Electron QA. Restore SQLite ABI with `pnpm run ensure:sqlite-abi` if Node tests rebuilt it.

Phase A is done when the measured feasibility result and exact next-stage contract are documented. #770 itself is done only after useful, precise interval-scoped suggestions pass held-out quality and resource gates, all invalidation paths pass, default enablement has a recorded policy decision, and canonical stop/final/reload/notes behavior is verified. Keep the feature off if any gate fails.

## GSTACK REVIEW REPORT

Verified findings: [P1, confidence 10/10] `identityHandlers.ts:271` checks `context.turns.some((turn) => turn.speaker === speaker)` while `commitmentIdentity.ts:17` derives revision with `hash(meeting?.transcript_json ?? null)`: ephemeral live clusters cannot reuse canonical confirmation. [P1, confidence 10/10] `parakeetRuntimeHost.ts:43` declares `private active: LeaseRecord | null = null`, with exclusive admission in `drain`; a second final lease is not live-analysis isolation. [P1, confidence 9/10] `SpeakerEvidence.swift:220` exposes file-URL analysis; rolling PCM and cross-window association need measured adapters. The actual achievable live precision/performance remains unverified, not presumed impossible.

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Engineering | Explicit plan review | Architecture, code quality, tests, performance | 1 | DONE_WITH_CONCERNS | Added native feasibility/quality gate; corrected file-vs-PCM API, exclusive leasing, cluster continuity, canonical binding and expiration assumptions; deferred live confirmation |
| Outside voice | In-host Codex check | Avoid nested self-review | 0 | Skipped | No independent cross-model endorsement claimed |
| Design | Not invoked here | Product integration held | 0 | Not run | Interval-level labels require post-gate UX QA |

**VERDICT:** Phase A is ready; production live identity is NOT CLEARED until A4 establishes feasibility, calibration, compatibility and precise interval ownership. Engineering sections completed under the user's full-quality authorization. Gstack startup/metadata tooling is degraded; no product changes or full product suite ran in this docs-only review.

**UNRESOLVED DECISIONS:**
- A4 must select measured window/cadence/resource limits and minimum useful coverage before Phase B.
- A4 must prove the production snapshot API, wire capability compatibility and interval association contract; current code does not establish them.
- Delivered voice-profile quality/lifecycle fixes and a held-out live calibration policy remain prerequisites for named rollout.
