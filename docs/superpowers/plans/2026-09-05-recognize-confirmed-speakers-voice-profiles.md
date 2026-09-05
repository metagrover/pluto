# Recognize Confirmed Speakers Across Meetings with Opt-In Local Voice Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize confirmed speakers across meetings using opt-in, privacy-first local voice profiles with calibrated deterministic matching, bounded native evidence aggregation, lossless merge/restore, and revision-bound concurrency protection.

**Architecture:** FluidAudio offline diarization in the native process aggregates clean, non-overlapping System-audio chunks into bounded per-cluster evidence. In the main process, candidate clusters (for `Remote Speaker N` or single-speaker `Them`) are evaluated against active local voice profiles using a calibrated global acoustic threshold and runner-up margin. Confirmed speakers can optionally enroll an immutable voice sample under their entity ID. Suggested matches in `SpeakerIdentificationModal` present candidate and reference audio before confirmation or rejection.

**Tech Stack:** Swift (FluidAudio, ParakeetRuntime, Accelerate/vDSP), TypeScript (Node.js/Electron, Better-SQLite3), React 18, TailwindCSS, Vitest.

---

### Task 1: Native Parakeet Runtime Protocol & Bounded Evidence Aggregation

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ProtocolTests.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`

- [ ] **Step 1: Write failing Swift tests for `SpeakerClusterEvidence` protocol encoding and clean chunk aggregation**

Add tests in `ProtocolTests.swift` for:
- Encoding/decoding `SpeakerClusterEvidence` (cluster, embedding, cleanChunkCount, cleanSegmentCount, cleanDurationSeconds, minimumChunkSimilarity, meanChunkSimilarity).
- Inclusion of `clusterEvidence: [SpeakerClusterEvidence]` in `SpeakerEvidenceOutput`.
- Extension of `SpeakerEvidenceProvenance` with `profileAlgorithmVersion: String`.
- Absence of raw chunk embeddings in public `SpeakerEvidenceOutput`.

Add tests in `FluidAudioSpeakerEvidenceTests.swift` for:
- Bounded aggregation of clean non-overlapping chunks.
- Rejection of invalid dimensions, zero norm, and NaN/Infinity vectors without discarding valid turns.
- Non-collinear centroid calculation and unit-length re-normalization.
- Retention of core diarization failure behaviors (not silencing failures).

- [ ] **Step 2: Run Swift tests to verify failure**

Run: `swift test --package-path native/parakeet-runtime --filter ProtocolTests`
Expected: FAIL due to missing types/fields.

- [ ] **Step 3: Implement `SpeakerClusterEvidence` and native clean aggregation**

In `Protocol.swift`:
- Define `public struct SpeakerClusterEvidence: Codable, Equatable, Sendable`.
- Update `SpeakerEvidenceOutput` to include `public let clusterEvidence: [SpeakerClusterEvidence]?`.
- Update `SpeakerEvidenceProvenance` to include `public let profileAlgorithmVersion: String`.

In `SpeakerEvidence.swift`:
- Set `config.exposeChunkEmbeddings = true`.
- Extract accepted non-overlapping System-speech intervals from `turns` and energy windows.
- For each cluster, filter time-aligned chunk embeddings within accepted intervals.
- Validate each vector (length == 256, finite, non-zero).
- Compute centroid, re-normalize, calculate minimum and mean pairwise similarity.
- Attach `clusterEvidence` to `SpeakerEvidenceOutput`.

- [ ] **Step 4: Run Swift tests to verify passing**

Run: `swift test --package-path native/parakeet-runtime`
Expected: All tests PASS.

- [ ] **Step 5: Commit native Swift protocol and engine changes**

```bash
git add native/parakeet-runtime/Sources native/parakeet-runtime/Tests
git commit -m "feat(native): bounded cluster evidence aggregation and provenance (#755)"
```

---

### Task 2: Native JSON-Line Response Handling and Bounded Transport Safety

**Files:**
- Modify: `electron/transcription/parakeetFinalClient.ts`
- Test: `tests/unit/parakeetFinalClient.test.ts`
- Test: `tests/unit/nativeJsonLineProcess.test.ts`

- [ ] **Step 1: Write failing tests for client-side `clusterEvidence` deserialization and size limits**

In `tests/unit/parakeetFinalClient.test.ts`:
- Test deserialization of `clusterEvidence` in `SpeakerEvidenceResult`.
- Test validation of `clusterEvidence` bounds (rejecting responses with > 64 clusters or malformed vectors).
- Test that responses exceeding 16 MiB are safely rejected.

- [ ] **Step 2: Run Vitest to verify failure**

Run: `pnpm vitest run tests/unit/parakeetFinalClient.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `parakeetFinalClient.ts` with `clusterEvidence` types and validation**

In `electron/transcription/parakeetFinalClient.ts`:
- Define `SpeakerClusterEvidence` interface.
- Add `clusterEvidence?: SpeakerClusterEvidence[]` to `SpeakerEvidenceResult`.
- Validate cluster count and dimensions during response decoding.

- [ ] **Step 4: Run Vitest to verify passing**

Run: `pnpm vitest run tests/unit/parakeetFinalClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit client transport changes**

```bash
git add electron/transcription/parakeetFinalClient.ts tests/unit/parakeetFinalClient.test.ts
git commit -m "feat(transcription): deserialize bounded cluster evidence from native parakeet (#755)"
```

---

### Task 3: Single and Multi-Speaker Candidate Mapping & Digest Generation

**Files:**
- Create: `src/services/speakerCandidateEvidence.ts`
- Modify: `src/services/finalTranscription/applyRemoteSpeakerClusters.ts`
- Test: `tests/unit/speakerCandidateEvidence.test.ts`
- Modify: `tests/unit/applyRemoteSpeakerClusters.test.ts`

- [ ] **Step 1: Write failing tests for candidate mapping, purity gating, and digest**

In `tests/unit/speakerCandidateEvidence.test.ts`:
- Single remote speaker meeting: preserves `Them` in transcript while producing candidate `Them`.
- Multi-speaker meeting: maps clusters to `Remote Speaker 1`, `Remote Speaker 2`.
- Digest calculation: SHA-256 over canonical little-endian Float32 bytes of the normalized vector + complete provenance tuple.
- Purity gating: verifies `isEligibleForEnrollment` requires $\ge 3.0$s clean speech, $\ge 2$ clean segments, $\ge 2$ clean chunks, and within-cluster similarity $\ge 0.70$.
- Impure or short turns produce `isEligibleForEnrollment = false`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/speakerCandidateEvidence.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `speakerCandidateEvidence.ts` and update `applyRemoteSpeakerClusters.ts`**

Implement:
- `deriveSpeakerCandidates(...)`: takes `clusterEvidence`, `systemEnergyWindows`, `segments`, and `provenance`.
- Produces `SpeakerCandidateEvidence` array with `candidateDigest`, `isEligibleForEnrollment`, clean duration, segment counts, reference interval, and embedding.
- Connect to `applyRemoteSpeakerClusters.ts` while preserving issue #749 transcript fallback behavior.

- [ ] **Step 4: Run tests to verify passing**

Run: `pnpm vitest run tests/unit/speakerCandidateEvidence.test.ts tests/unit/applyRemoteSpeakerClusters.test.ts`
Expected: PASS

- [ ] **Step 5: Commit candidate mapping changes**

```bash
git add src/services/speakerCandidateEvidence.ts src/services/finalTranscription/applyRemoteSpeakerClusters.ts tests/unit/speakerCandidateEvidence.test.ts tests/unit/applyRemoteSpeakerClusters.test.ts
git commit -m "feat(attribution): single and multi-speaker candidate evidence extraction (#755)"
```

---

### Task 4: Biometric Protection & Candidate Evidence Database Operations

**Files:**
- Create: `electron/speakerVoiceStore.ts`
- Modify: `electron/db.ts`
- Modify: `src/services/finalTranscription/runFinalTranscription.ts`
- Test: `tests/unit/speakerVoiceStore.test.ts`

- [ ] **Step 1: Write failing tests for candidate evidence table and atomic commit**

In `tests/unit/speakerVoiceStore.test.ts`:
- Database schema: `meeting_speaker_candidates` table created.
- Atomic commit: transcript and candidate rows written in same SQLite transaction; old generations deleted only after new commit succeeds.
- Meeting deletion cascades and wipes all candidate vectors.
- Knowledge base reset wipes candidates.
- Verify raw embeddings are NEVER written into `transcript_json` or meeting metadata.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/speakerVoiceStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement candidate table and atomic commit in `electron/speakerVoiceStore.ts` and `db.ts`**

- Create `meeting_speaker_candidates` table in SQLite with `ON DELETE CASCADE`.
- Implement `saveMeetingSpeakerCandidates(meetingId, sourceRevision, candidates)` inside `db.ts`.
- In `runFinalTranscription.ts`, pass candidates to `commitCanonical` so transcript and candidate rows commit together atomically.
- Exclude `meeting_speaker_candidates` from exports and sync payloads.

- [ ] **Step 4: Run tests to verify passing**

Run: `pnpm vitest run tests/unit/speakerVoiceStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit candidate persistence**

```bash
git add electron/speakerVoiceStore.ts electron/db.ts src/services/finalTranscription/runFinalTranscription.ts tests/unit/speakerVoiceStore.test.ts
git commit -m "feat(db): atomic meeting speaker candidate persistence and cascade (#755)"
```

---

### Task 5: Lossless Person Merge, Restore, and Dynamic Canonical Voice Aggregation

**Files:**
- Modify: `electron/speakerVoiceStore.ts`
- Modify: `electron/db.ts`
- Test: `tests/unit/speakerVoiceMergeRestore.test.ts`

- [ ] **Step 1: Write failing tests for immutable enrollments, merge, restore, and profile settings**

In `tests/unit/speakerVoiceMergeRestore.test.ts`:
- `speaker_voice_enrollments` stores immutable records under original `person_id`.
- Dynamic aggregation resolves `canonicalPersonId = resolvePersonIdentityId(person_id)`.
- Person merge: combines enrollments dynamically at read time via weighted centroid.
- Person restore: deactivating alias immediately restores exact uncorrupted original profiles for both persons.
- Disabling merged destination stops combined matching without mutating source enrollments; restore recovers prior active states.
- Permanent deletion rejected on merged family with explicit error message.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/speakerVoiceMergeRestore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement enrollment storage, dynamic canonical aggregation, and settings in `speakerVoiceStore.ts`**

- Create `speaker_voice_enrollments` and `speaker_voice_profile_settings` tables in SQLite.
- Implement `enrollSpeakerVoice(...)`, `getCanonicalVoiceProfiles(...)`, `setVoiceProfileStatus(...)`, `deleteVoiceProfile(...)`.
- Enforce merge-family deletion protection (`Restore this person merge before permanently deleting voice samples.`).

- [ ] **Step 4: Run tests to verify passing**

Run: `pnpm vitest run tests/unit/speakerVoiceMergeRestore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit lossless merge and enrollment store**

```bash
git add electron/speakerVoiceStore.ts electron/db.ts tests/unit/speakerVoiceMergeRestore.test.ts
git commit -m "feat(identity): lossless person-merge voice profile aggregation and restore (#755)"
```

---

### Task 6: Deterministic Matcher & Global Acoustic Calibration Policy

**Files:**
- Create: `src/services/speakerVoiceMatcher.ts`
- Test: `tests/unit/speakerVoiceMatcher.test.ts`

- [ ] **Step 1: Write failing tests for calibrated matcher, threshold, margin, and provenance**

In `tests/unit/speakerVoiceMatcher.test.ts`:
- Returns `null` when calibration policy is disabled (`voice_profile_suggestions_v1: false`).
- Exact provenance matching: rejects incompatible model revision or artifact digest.
- Single profile: matches when similarity $\ge 0.72$ and candidate purity passes.
- Two profiles: matches top candidate when margin over runner-up $\ge 0.10$. Suppresses match when margin $< 0.10$.
- Rejection exclusion: excludes candidate matching `(meetingId, speaker, sourceRevision, candidateDigest)`.
- Calendar isolation: calendar attendee candidate cannot alter acoustic score, margin, or winner; only annotates `isCalendarAttendee: true` when candidate 1 independently qualifies.
- Content-free diagnostics: logs only allowed telemetry categories without biometric or personal data.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/speakerVoiceMatcher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `speakerVoiceMatcher.ts`**

Implement:
- `matchSpeakerCandidates(...)`:
  - Calibration policy with threshold $0.72$, margin $0.10$, within-cluster similarity $\ge 0.70$.
  - Exact provenance key check.
  - Strict acoustic ranking and margin evaluation.
  - Calendar context annotation only.
  - Feature flag check (`voice_profile_suggestions_v1`).

- [ ] **Step 4: Run tests to verify passing**

Run: `pnpm vitest run tests/unit/speakerVoiceMatcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit matcher implementation**

```bash
git add src/services/speakerVoiceMatcher.ts tests/unit/speakerVoiceMatcher.test.ts
git commit -m "feat(matching): calibrated global acoustic matcher with margin and provenance gates (#755)"
```

---

### Task 7: Revision-Bound Actions & IPC Transactional Integration

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/api/identity.ts`
- Test: `tests/unit/speakerVoiceRevision.test.ts`

- [ ] **Step 1: Write failing tests for revision-bound confirm, reject, enroll, and IPC channels**

In `tests/unit/speakerVoiceRevision.test.ts`:
- Rejection suppresses only for the exact `sourceRevision` and `candidateDigest`.
- Invalidate stale actions when `transcript_json` changes (`sourceRevision` mismatch).
- Invalidate stale actions when `identity_workspace.revision` changes (`expectedRevision` mismatch).
- IPC handler validation for `GET_MEETING_SPEAKER_SUGGESTIONS`, `CONFIRM_SPEAKER_SUGGESTION`, `REJECT_SPEAKER_SUGGESTION`, `ENROLL_SPEAKER_VOICE_PROFILE`.
- Renderer boundary: verify response descriptors contain no raw vectors.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/speakerVoiceRevision.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire IPC handlers in `electron/main.ts` and export client methods in `src/api/identity.ts`**

- In `electron/main.ts`:
  - Register `GET_MEETING_SPEAKER_SUGGESTIONS`.
  - Register `CONFIRM_SPEAKER_SUGGESTION` (calls `setMeetingIdentityBinding` transactionally).
  - Register `REJECT_SPEAKER_SUGGESTION` (writes `speaker_voice_rejections`).
  - Register `ENROLL_SPEAKER_VOICE_PROFILE`.
  - Register `SET_VOICE_PROFILE_STATUS` and `DELETE_VOICE_PROFILE`.
- In `src/api/identity.ts`:
  - Define interfaces: `SpeakerSuggestionDescriptor`, `SpeakerSuggestionResult`, `SpeakerVoiceProfileDetail`.
  - Implement client invoke wrappers.

- [ ] **Step 4: Run tests to verify passing**

Run: `pnpm vitest run tests/unit/speakerVoiceRevision.test.ts`
Expected: PASS

- [ ] **Step 5: Commit IPC handlers and client API**

```bash
git add electron/main.ts src/api/identity.ts tests/unit/speakerVoiceRevision.test.ts
git commit -m "feat(ipc): revision-bound speaker suggestions, rejections, and enrollment (#755)"
```

---

### Task 8: UI Integration: Speaker Review Modal (`SpeakerIdentificationModal.tsx`)

**Files:**
- Modify: `src/components/features/SpeakerIdentificationModal.tsx`
- Test: `tests/unit/SpeakerIdentificationModal.dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests for suggestion banner, reference sample, and opt-in enrollment**

In `tests/unit/SpeakerIdentificationModal.dom.test.tsx`:
- Renders `Speaker 1 may be Alex` (or `Them may be Alex`) with `Strong match` badge and `On calendar` badge if applicable.
- Buttons for `Play current sample` and `Play Alex's reference sample`.
- Clicking `Confirm Alex` invokes `CONFIRM_SPEAKER_SUGGESTION` and advances.
- Clicking `Not Alex` invokes `REJECT_SPEAKER_SUGGESTION` and shows standard combobox.
- Opt-in `Remember this voice for future meetings` checkbox is shown when `isEligibleForEnrollment = true` and unchecked by default.
- Checkbox is hidden when `isEligibleForEnrollment = false`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement suggestion banner and enrollment checkbox in `SpeakerIdentificationModal.tsx`**

- Load candidate suggestions via `getMeetingSpeakerSuggestions(meetingId)`.
- Render suggestion card with audio playback for current candidate turn and reference sample.
- Wire `Confirm` and `Not Alex` actions with revision protection.
- Render `Remember this voice for future meetings` checkbox upon manual confirmation or suggestion confirmation.

- [ ] **Step 4: Run DOM tests to verify passing**

Run: `pnpm vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit modal changes**

```bash
git add src/components/features/SpeakerIdentificationModal.tsx tests/unit/SpeakerIdentificationModal.dom.test.tsx
git commit -m "feat(ui): speaker suggestion review and opt-in enrollment in identification modal (#755)"
```

---

### Task 9: UI Integration: Person Dossier Voice Profile (`PeopleTab.tsx`)

**Files:**
- Modify: `src/components/KnowledgeGraph/PeopleTab.tsx`
- Test: `tests/unit/PeopleTab.dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests for Person Dossier Voice Profile card**

In `tests/unit/PeopleTab.dom.test.tsx`:
- Displays "Voice Profile" card when a person has enrolled voice data.
- Shows status (`Active` or `Disabled`), sample count, and clean speech duration.
- Play reference sample button.
- Toggle disable/enable matching.
- Delete voice profile button.
- Displays `Restore this person merge before permanently deleting voice samples.` when viewing a merged person.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/PeopleTab.dom.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement Voice Profile card in `PeopleTab.tsx`**

- Add voice profile section to `PersonDossier`.
- Connect reference sample audio player.
- Implement toggle disable/enable and delete voice profile actions with error handling.

- [ ] **Step 4: Run DOM tests to verify passing**

Run: `pnpm vitest run tests/unit/PeopleTab.dom.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit dossier UI changes**

```bash
git add src/components/KnowledgeGraph/PeopleTab.tsx tests/unit/PeopleTab.dom.test.tsx
git commit -m "feat(ui): voice profile management and merge disclosure in person dossier (#755)"
```

---

### Task 10: Private Calibration Benchmark, Documentation, and Changelog

**Files:**
- Create: `scripts/benchmark_voice_calibration.ts`
- Create: `tests/unit/privateVoiceBenchmark.test.ts`
- Create: `docs/changelog/entries/2026-09-05-755-recognize-confirmed-speakers.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Implement private calibration benchmark harness and tests**

In `scripts/benchmark_voice_calibration.ts` and `tests/unit/privateVoiceBenchmark.test.ts`:
- Structured benchmark evaluating 5+ speakers across 3+ meeting applications.
- Verifies zero false suggestions requirement.
- Asserts report contains only content-free aggregate counts and percentiles; fails if identities, audio, text, or paths appear in report output.

- [ ] **Step 2: Run benchmark test to verify passing**

Run: `pnpm vitest run tests/unit/privateVoiceBenchmark.test.ts`
Expected: PASS

- [ ] **Step 3: Record decision and changelog fragment**

- Update `docs/decisions.md` documenting the local voice profile architecture, calibration thresholds, biometric privacy policy, and default-off suggestion gate.
- Create `docs/changelog/entries/2026-09-05-755-recognize-confirmed-speakers.md`.
- Verify with `pnpm run changelog:check`.

- [ ] **Step 4: Run full test and lint suite**

Run:
- `pnpm exec tsc --noEmit`
- `pnpm run lint`
- `pnpm run changelog:check`
- `pnpm test`
- `swift test --package-path native/parakeet-runtime`
Expected: All pass cleanly.

- [ ] **Step 5: Commit documentation and changelog**

```bash
git add scripts/benchmark_voice_calibration.ts tests/unit/privateVoiceBenchmark.test.ts docs/decisions.md docs/changelog/entries/2026-09-05-755-recognize-confirmed-speakers.md
git commit -m "docs: record decisions and changelog for cross-meeting speaker recognition (#755)"
```
