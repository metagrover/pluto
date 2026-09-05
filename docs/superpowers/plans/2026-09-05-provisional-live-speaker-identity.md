# Provisional Live Speaker Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, precision-first `Likely <name>` labels to stable remote live-transcript turns after enough clean local voice evidence exists, without changing words, ordering, canonical anonymous labels, or People evidence until explicit confirmation.

**Architecture:** Extend the native EOU session with an asynchronous bounded System-audio speaker-evidence lane. Sensitive cluster embeddings cross only the existing trusted native JSON-line boundary into the Electron main process. Main-process matching reuses the calibrated local voice-profile policy and emits an opaque, sanitized identity hint to the renderer. A meeting-scoped hysteresis state machine applies hints to existing conversation turns by time interval; it can change a label in place but cannot add, remove, reorder, or rewrite transcript content.

**Tech Stack:** Swift/FluidAudio, TypeScript/Electron, Better-SQLite3, React 18, Vitest, Swift Testing/XCTest.

**Issue:** [#770 — Add provisional live speaker identity without destabilizing transcripts](https://github.com/metagrover/pluto/issues/770)

**Dependencies:** Complete the stable conversation projection in #670 first. Rebase onto the delivered #755/#768 voice-profile implementation instead of duplicating enrollment, calibration, profile storage, or matching logic.

---

## Product and privacy contract

- The transcript remains fully usable as `You` and `Call` when live identity is unavailable or disabled.
- The only automatic named state is `Likely Alex`. A bare `Alex` label requires an explicit meeting-scoped identity binding.
- Identity updates may replace the small speaker label in place. They may not alter transcript text, timestamps, fragment membership, turn order, scroll position, notes, commitments, or People evidence.
- Weak, mixed, overlapping, close-runner-up, stale-version, rejected, or failed evidence remains anonymous.
- The renderer receives an opaque suggestion ID, display name, covered time ranges, and state. It never receives embeddings, similarity scores, candidate digests, profile vectors, audio paths, or model internals.
- The native JSON-line process and Electron main process are the existing trusted local biometric boundary. No biometric vectors enter renderer IPC, logs, analytics, committed fixtures, screenshots, or GitHub evidence.
- Suggestions remain default-off until the private real-time benchmark records zero false named suggestions. A missed suggestion is acceptable; a false name is not.

## Renderer contract

```ts
export type LiveSpeakerIdentityHint = {
  suggestionId: string;
  label: string;
  state: 'suggested' | 'confirmed';
  intervals: Array<{ startMs: number; endMs: number }>;
  generation: number;
  revision: number;
};

export type LiveConversationTurn = {
  // Existing #670 fields remain unchanged.
  identity?: LiveSpeakerIdentityHint;
};
```

`suggestionId` is ephemeral and meeting-scoped. Main process retains its mapping to candidate/profile evidence for confirmation or rejection.

---

### Task 1: Lock the trust boundary and real-time benchmark gates

**Files:**
- Create: `src/services/liveTranscription/liveSpeakerIdentityContract.ts`
- Create: `tests/unit/liveSpeakerIdentityContract.test.ts`
- Create: `scripts/validate_private_live_speaker_identity_manifest.ts`
- Create: `tests/unit/privateLiveSpeakerIdentityManifest.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing contract tests**

Validate that renderer hints accept only an opaque ID, bounded display label, state, monotonic revision, and at most 64 finite intervals. Reject unknown keys so embeddings, scores, digests, paths, transcript text, or raw audio cannot leak into renderer payloads.

- [ ] **Step 2: Define the private benchmark manifest**

Require case categories for known speaker, unseen speaker, similar speaker, two remote speakers, overlap, loudspeaker bleed, headphones, disabled/deleted profile, incompatible model version, and runtime failure. The committed validator may read only aggregate case metadata; identities and local paths stay in the ignored private manifest.

- [ ] **Step 3: Add the validation script and package command**

Add `benchmark:private-live-speaker-identity:validate`. The validator must reject manifests missing negative controls or containing names, transcript excerpts, embeddings, similarity values, meeting IDs, or absolute paths in the report schema.

- [ ] **Step 4: Run tests and verify pass**

```bash
pnpm vitest run tests/unit/liveSpeakerIdentityContract.test.ts tests/unit/privateLiveSpeakerIdentityManifest.test.ts
pnpm run benchmark:private-live-speaker-identity:validate
```

Expected: contract tests PASS. Manifest validation PASSes in a configured private environment; otherwise it exits successfully with an explicit `SKIP: no private manifest` and supports no benchmark claim.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscription/liveSpeakerIdentityContract.ts tests/unit/liveSpeakerIdentityContract.test.ts scripts/validate_private_live_speaker_identity_manifest.ts tests/unit/privateLiveSpeakerIdentityManifest.test.ts package.json
git commit -m "test(identity): define private live speaker trust contract (#770)"
```

---

### Task 2: Produce bounded incremental speaker evidence off the EOU hot path

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/EouProtocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/LiveProtocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetEouSession.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/EouProtocolTests.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/ParakeetLiveSessionTests.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`

- [ ] **Step 1: Write failing protocol and scheduling tests**

Add a `live_speaker_evidence` event carrying generation, revision, covered time range, anonymous turns, bounded `SpeakerClusterEvidence`, and provenance. Test malformed vectors, more than 16 turns/clusters, stale generations, non-monotonic revisions, and content-free descriptions.

- [ ] **Step 2: Write hot-path isolation tests**

Prove EOU append never awaits speaker analysis, at most one analysis is in flight, new frames coalesce while busy, and analysis failure still emits ordinary `eou_update` events. Cancellation/reset must clear buffered audio and invalidate late evidence.

- [ ] **Step 3: Add the bounded analysis lane**

Maintain a 45-second rolling mic/System PCM window inside the native session. No more often than every 12 seconds, snapshot the window and asynchronously reuse `SpeakerEvidenceCoordinator` to:

- diarize System audio;
- exclude intervals with mic activity or speaker overlap;
- aggregate clean interval metrics without copying TypeScript thresholds into Swift; the main process remains the single owner of `isCandidateEligibleForEnrollment` and its calibrated gates;
- emit at most 16 anonymous turns and 16 cluster aggregates;
- discard results whose generation changed before completion.

Do not change EOU ASR snapshots, prefix behavior, or source text.

- [ ] **Step 4: Run the native suite**

```bash
swift test --package-path native/parakeet-runtime --filter EouProtocolTests
swift test --package-path native/parakeet-runtime --filter ParakeetLiveSessionTests
swift test --package-path native/parakeet-runtime --filter FluidAudioSpeakerEvidenceTests
```

Expected: PASS with speaker-analysis failures isolated from transcription.

- [ ] **Step 5: Commit**

```bash
git add native/parakeet-runtime/Sources native/parakeet-runtime/Tests
git commit -m "feat(native): emit bounded live speaker evidence (#770)"
```

---

### Task 3: Validate native events and keep embeddings out of renderer IPC

**Files:**
- Modify: `electron/transcription/nativeJsonLineProcess.ts`
- Modify: `electron/transcription/parakeetEouClient.ts`
- Modify: `electron/transcription/parakeetEouMeetingCoordinator.ts`
- Create: `electron/transcription/liveSpeakerIdentityCoordinator.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/nativeJsonLineProcess.test.ts`
- Modify: `tests/unit/parakeetEouClient.test.ts`
- Modify: `tests/unit/parakeetEouMeetingCoordinator.test.ts`
- Create: `tests/unit/liveSpeakerIdentityCoordinator.test.ts`

- [ ] **Step 1: Write failing native boundary tests**

Add `NativeLiveSpeakerEvidenceEvent` to the TypeScript event union and allowlist. Test strict dimensions/counts, finite numbers, provenance compatibility, generation ownership, maximum encoded bytes, and rejection of text/path fields.

- [ ] **Step 2: Write failing main-process sanitization tests**

Feed a valid cluster aggregate to the coordinator. Assert that matching receives the vector in main memory but the emitted `PARAKEET_LIVE_SPEAKER_HINT` payload contains only the validated renderer contract. Search serialized payloads to prove the embedding, score, candidate digest, and source paths are absent.

- [ ] **Step 3: Implement the main-process coordinator**

Inject profile, rejection, and identity-binding readers rather than importing UI APIs. Reuse `deriveSpeakerCandidates`, `matchSpeakerVoice`, and the current calibration policy. Keep an in-memory map from opaque `suggestionId` to meeting ID, source generation, native cluster, candidate digest, person ID, and evidence revision.

- [ ] **Step 4: Add ownership and lifecycle guards**

Forward sanitized hints only to the current capture owner and generation. Clear suggestion maps on reset, stop, owner destruction, profile deletion/disable, knowledge reset, and meeting deletion. Never persist provisional live suggestions.

- [ ] **Step 5: Run focused Electron tests**

```bash
pnpm vitest run tests/unit/nativeJsonLineProcess.test.ts tests/unit/parakeetEouClient.test.ts tests/unit/parakeetEouMeetingCoordinator.test.ts tests/unit/liveSpeakerIdentityCoordinator.test.ts tests/unit/speakerVoiceMatcher.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/transcription electron/main.ts tests/unit/nativeJsonLineProcess.test.ts tests/unit/parakeetEouClient.test.ts tests/unit/parakeetEouMeetingCoordinator.test.ts tests/unit/liveSpeakerIdentityCoordinator.test.ts
git commit -m "feat(identity): sanitize live speaker matches in main process (#770)"
```

---

### Task 4: Add monotonic suggestion hysteresis

**Files:**
- Create: `src/services/liveTranscription/liveSpeakerIdentityProjection.ts`
- Create: `tests/unit/liveSpeakerIdentityProjection.test.ts`
- Modify: `src/services/liveTranscription/liveConversationProjection.ts`
- Modify: `tests/unit/liveConversationProjection.test.ts`

- [ ] **Step 1: Write state-transition tests**

Require two consecutive compatible native evidence revisions for the same person and overlapping anonymous intervals before showing a suggestion. Cover:

- anonymous → `Likely Alex` after two stable matches;
- repeated Alex evidence is idempotent;
- one missing update does not flicker the label;
- Alex followed by a conflicting Sam candidate returns to `Call` and suppresses further automatic naming for that cluster during the meeting;
- rejection returns to `Call` and cannot re-suggest the same candidate digest;
- confirmation becomes `Alex` and survives later missing evidence;
- stale generation/revision updates are ignored;
- identity changes preserve turn IDs, text, order, and scroll frontier.

- [ ] **Step 2: Implement a pure hysteresis reducer**

```ts
export function createLiveSpeakerIdentityProjection(): {
  apply(hint: LiveSpeakerIdentityHint): ReadonlyMap<string, LiveSpeakerIdentityHint>;
  reject(suggestionId: string): void;
  confirm(suggestionId: string, label: string): void;
  reset(generation: number): void;
};
```

Map a hint to turns by interval overlap, not transcript text or row order. Suggestions may decorate existing turns but cannot participate in conversation grouping or reconciliation.

- [ ] **Step 3: Integrate identity after #670 projection**

Apply identity decoration to the completed `LiveConversationView`. Add a regression that identical fragments produce identical history before and after any sequence of identity events.

- [ ] **Step 4: Run projection tests**

```bash
pnpm vitest run tests/unit/liveSpeakerIdentityProjection.test.ts tests/unit/liveConversationProjection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscription/liveSpeakerIdentityProjection.ts src/services/liveTranscription/liveConversationProjection.ts tests/unit/liveSpeakerIdentityProjection.test.ts tests/unit/liveConversationProjection.test.ts
git commit -m "feat(identity): add monotonic live speaker hint projection (#770)"
```

---

### Task 5: Wire suggestions and explicit meeting-scoped decisions

**Files:**
- Create: `src/api/liveSpeakerIdentity.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/features/ZenMode.tsx`
- Modify: `src/api/identity.ts`
- Modify: `electron/main.ts`
- Modify: `electron/identityHandlers.ts`
- Create: `tests/unit/liveSpeakerIdentityApi.test.ts`
- Modify: `tests/unit/audioManagerParakeetEouWiring.test.ts`
- Modify: `tests/unit/identityHandlers.test.ts`

- [ ] **Step 1: Add a renderer subscription for sanitized hints**

`AudioManager` subscribes to `PARAKEET_LIVE_SPEAKER_HINT`, validates with `liveSpeakerIdentityContract`, and applies the hint only when meeting and capture generation match. No polling and no profile fetch occurs in React.

- [ ] **Step 2: Add explicit confirm/reject commands**

Define `LIVE_SPEAKER_IDENTITY_CONFIRM` and `LIVE_SPEAKER_IDENTITY_REJECT`. Both accept only meeting ID, opaque suggestion ID, and expected identity revision. Main resolves the in-memory evidence mapping.

- [ ] **Step 3: Reuse canonical identity operations**

Confirmation calls the same revision-checked meeting-scoped binding path as `setMeetingIdentityBinding`; rejection writes the existing bounded voice rejection keyed by candidate evidence. Neither command enrolls a new voice profile or changes canonical anonymous acoustic labels.

- [ ] **Step 4: Test stale and missing evidence**

Assert a restarted app, expired suggestion, stale identity revision, deleted person, disabled profile, changed generation, or mismatched meeting fails closed and reloads anonymous state. No command may accept a renderer-supplied person ID or display name as proof.

- [ ] **Step 5: Run focused tests**

```bash
pnpm vitest run tests/unit/liveSpeakerIdentityApi.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/identityHandlers.test.ts tests/unit/speakerVoiceHandlers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/liveSpeakerIdentity.ts src/components/AudioManager.tsx src/App.tsx src/components/features/ZenMode.tsx src/api/identity.ts electron/main.ts electron/identityHandlers.ts tests/unit/liveSpeakerIdentityApi.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/identityHandlers.test.ts
git commit -m "feat(identity): confirm or reject live speaker suggestions (#770)"
```

---

### Task 6: Render a quiet provisional label without transcript movement

**Files:**
- Modify: `src/components/features/LiveTranscript.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/LiveTranscript.dom.test.tsx`

- [ ] **Step 1: Write failing UX regressions**

Render `Call`, then `Likely Alex`, then confirmed `Alex` against the same turn. Assert the `<article data-turn-id>` node, text node content, order, scroll position, and timestamp remain unchanged. Assert suggested state is announced no more than once and is not represented by color alone.

- [ ] **Step 2: Render suggestion semantics**

Show `Likely Alex` as the primary speaker label with a small neutral `Suggested` qualifier. Clicking it opens a compact popover with `Confirm Alex`, `Not Alex`, and `Review after meeting`. Do not interrupt typing, steal focus, open a modal automatically, or animate transcript rows.

- [ ] **Step 3: Render confirmed and fallback states**

After confirmation show `Alex` with no provisional qualifier. After rejection/conflict/failure return to `Call`. Keep the post-meeting Speaker Review entry point available for every state.

- [ ] **Step 4: Verify accessibility and reduced motion**

The trigger and actions are keyboard operable, have visible focus, expose state text to assistive technology, and respect `prefers-reduced-motion`. The transcript body remains outside `aria-live`; only a dedicated status node announces the first stable suggestion.

- [ ] **Step 5: Run DOM tests**

```bash
pnpm vitest run tests/unit/LiveTranscript.dom.test.tsx
```

Expected: PASS with no history movement.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/LiveTranscript.tsx src/index.css tests/unit/LiveTranscript.dom.test.tsx
git commit -m "feat(identity): show calm provisional live speaker labels (#770)"
```

---

### Task 7: Benchmark resource isolation, precision, and rollout

**Files:**
- Create: `scripts/run_live_speaker_identity_benchmark.ts`
- Create: `tests/unit/liveSpeakerIdentityBenchmark.test.ts`
- Create: `docs/qa/live-speaker-identity.md`
- Create: `docs/changelog/entries/2026-09-05-provisional-live-speaker-identity.md`
- Modify: `docs/decisions.md` only if the default-on gate passes

- [ ] **Step 1: Add content-free benchmark metrics**

Report eligible cases, true suggestions, false suggestions, missed matches, ambiguity suppressions, conflict lockouts, time-to-first-suggestion, analysis latency p50/p95, peak rolling-buffer bytes, EOU append latency p95, and maximum native queue depth. Reports contain no names, IDs, text, paths, embeddings, or raw scores.

- [ ] **Step 2: Add deterministic benchmark tests**

Use synthetic vectors and time ranges to prove aggregate counts, zero leakage, single-flight scheduling, and the two-revision hysteresis requirement. Do not commit real biometric vectors.

- [ ] **Step 3: Run repository gates**

```bash
pnpm vitest run tests/unit/liveSpeakerIdentityContract.test.ts tests/unit/liveSpeakerIdentityCoordinator.test.ts tests/unit/liveSpeakerIdentityProjection.test.ts tests/unit/liveSpeakerIdentityApi.test.ts tests/unit/liveSpeakerIdentityBenchmark.test.ts tests/unit/LiveTranscript.dom.test.tsx
swift test --package-path native/parakeet-runtime
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
pnpm run test -- --run
```

Expected: PASS. Run `pnpm run ensure:sqlite-abi` before Electron acceptance if Node tests changed the `better-sqlite3` ABI.

- [ ] **Step 4: Run the consented private real-time corpus**

Use at least two conference applications and every category from Task 1. Require:

- zero false named suggestions;
- zero transcript history mutations or reorders;
- no increase in EOU queue depth beyond the existing bound of four;
- no blocked or failed EOU updates caused by speaker analysis;
- one analysis in flight maximum;
- clean anonymous fallback for every failure and ambiguity case.

Record only aggregate metrics and pass/fail observations in `docs/qa/live-speaker-identity.md`.

- [ ] **Step 5: Keep the feature default-off unless every gate passes**

Use a separate `voice_profile_live_suggestions_v1` setting; do not reuse the post-meeting suggestion flag. If the corpus has any false named suggestion or capture regression, ship code default-off, document the failure category, and keep #770 open. If all gates pass, record the policy and evidence in `docs/decisions.md` before changing the default.

- [ ] **Step 6: Commit benchmark and rollout artifacts**

```bash
git add scripts/run_live_speaker_identity_benchmark.ts tests/unit/liveSpeakerIdentityBenchmark.test.ts docs/qa/live-speaker-identity.md docs/changelog/entries/2026-09-05-provisional-live-speaker-identity.md docs/decisions.md package.json
git commit -m "test(identity): gate provisional live speaker rollout (#770)"
```

---

## Definition of done

- #670 is complete and the stable conversation projection is the only live rendering path.
- Known speakers may progress `Call` → `Likely Alex` → explicitly confirmed `Alex` without changing transcript content or layout.
- Conflicting or weak evidence remains or returns to `Call`; names do not oscillate.
- Biometric vectors stay inside the native/main trust boundary and never enter renderer IPC or logs.
- EOU transcription remains responsive when speaker analysis is slow, unavailable, cancelled, or incompatible.
- Default enablement occurs only after zero false named suggestions in the consented private real-time corpus.
