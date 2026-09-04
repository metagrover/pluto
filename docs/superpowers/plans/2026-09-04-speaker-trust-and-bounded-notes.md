# Speaker Trust and Bounded Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent microphone participants from being asserted as the workspace user and make production notes compilation terminate within a deterministic request and time budget.

**Status:** Completed and verified on 2026-09-04. The checklists below preserve the original execution sequence; completion evidence is recorded in issues #725 and #753.

**Architecture:** Extend native evidence with independent microphone clusters, project ambiguous local voices to meeting-local labels, and separate speaker separation from self identity at canonical and downstream gates. Route notes using the encoded provider payload and replace the production compact hierarchy with a bounded leaf writer/editor compiler.

**Tech Stack:** Swift, FluidAudio, TypeScript, Electron IPC, React meeting identity controls, Vitest, Swift Testing.

---

### Task 1: Return microphone diarization evidence

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeCore/Protocol.swift`
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Modify: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`
- Modify: `tests/unit/parakeetFinalClient.test.ts`

- [ ] **Step 1: Write failing Swift and client tests**

Add assertions that the coordinator diarizes System and microphone inputs independently and returns `turns` for System plus `micTurns` for microphone. Add a client fixture with both arrays and assert malformed `micTurns` fails protocol validation.

- [ ] **Step 2: Verify red**

Run `swift test --package-path native/parakeet-runtime --filter FluidAudioSpeakerEvidenceTests` and `pnpm vitest run tests/unit/parakeetFinalClient.test.ts`. Expect failures because `micTurns` is absent.

- [ ] **Step 3: Implement the minimal protocol extension**

Add `micTurns: [SpeakerEvidenceTurn]` to `SpeakerEvidenceOutput`; invoke the existing actor-backed diarizer for System and microphone; sum both diarization durations; validate and return the new field from `parakeetFinalClient`.

- [ ] **Step 4: Verify green**

Repeat the focused Swift and Vitest commands and expect zero failures.

### Task 2: Separate speaker separation from owner identity

**Files:**
- Create: `src/services/finalTranscription/applyLocalSpeakerClusters.ts`
- Create: `tests/unit/applyLocalSpeakerClusters.test.ts`
- Modify: `src/services/finalTranscription/applyRecoveredChannelEvidence.ts`
- Modify: `tests/unit/applyRecoveredChannelEvidence.test.ts`
- Modify: `src/services/finalTranscription/runFinalTranscription.ts`
- Modify: `tests/unit/runFinalTranscription.test.ts`
- Modify: `src/utils/transcriptSchema.ts`
- Modify: `src/utils/speakerAttributionTrust.ts`
- Modify: `tests/unit/speakerAttributionTrust.test.ts`

- [ ] **Step 1: Write failing projection and trust tests**

Cover deterministic `Local Speaker 1/2` ordering, under-covered cluster abstention, multi-cluster acceptance with unresolved self identity, and single-cluster compatibility. Assert `isVerifiedSpeakerAttribution` remains false while a new `isSpeakerSeparatedAttribution` predicate is true for safe anonymous separation.

- [ ] **Step 2: Verify red**

Run the focused attribution tests and confirm failures are caused by missing local-cluster and separation behavior.

- [ ] **Step 3: Implement projection and trust metadata**

Project microphone words/segments only when one unambiguous cluster covers at least half the item and total supported microphone coverage reaches 0.8. Multi-cluster results use `recovered_channel_acoustic_v3`, `mappingApplied: false`, `speakerSeparation: verified`, and `selfIdentity: unresolved`. Preserve v2 for the compatible single-speaker path.

- [ ] **Step 4: Wire finalization**

Run local projection before recovered-channel evidence and System projection. Commit only accepted separation; never convert `Local Speaker N` back to `Me`.

- [ ] **Step 5: Verify green**

Run the focused attribution and finalization tests and expect zero failures.

### Task 3: Persist the trust vector and exact failure reasons

**Files:**
- Modify: `src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts`
- Modify: `tests/unit/runPersistedMeetingFinalTranscription.test.ts`
- Modify: `src/services/postMeetingProcessingCoordinator.ts`
- Modify: `tests/unit/postMeetingProcessingCoordinator.test.ts`
- Modify: `src/utils/transcriptTrustState.ts`
- Modify: `electron/main.ts`
- Modify: `electron/db.ts`
- Modify: relevant DB final-transcription tests

- [ ] **Step 1: Write failing persistence tests**

Assert canonical commit accepts verified separation with unresolved identity, writes `speakerAttributionVerified: false` and `speakerSeparationVerified: true`, and permits notes processing. Assert `remote_speech_unaccounted` and attribution rejection reasons survive `FAIL_FINAL_TRANSCRIPTION` into the integrity envelope.

- [ ] **Step 2: Verify red**

Run the focused persisted-finalization, coordinator, trust-envelope, and DB tests and confirm expected failures.

- [ ] **Step 3: Implement the compatibility-safe persistence change**

Accept `isSpeakerSeparatedAttribution` at canonical commit, derive both booleans, allow the optional trust key in schema-v2 parsing, forward bounded reason arrays through IPC, and persist them without transcript text or paths.

- [ ] **Step 4: Verify green**

Repeat the focused commands and expect zero failures.

### Task 4: Route on the encoded notes request

**Files:**
- Modify: `electron/llm/meetingNotesWire.ts`
- Modify: `electron/llm/meetingNotesPipeline.ts`
- Modify: `tests/unit/meetingNotesWire.test.ts`
- Modify: `tests/unit/meetingNotesPipeline.test.ts`

- [ ] **Step 1: Write failing wire-capacity tests**

Construct a highly segmented source whose raw prompt exceeds context but encoded writer/editor prompts fit. Assert the compact production path makes exactly writer then editor and never invokes hierarchy stages.

- [ ] **Step 2: Verify red**

Run the wire and pipeline tests and confirm the current code incorrectly enters hierarchy or throws context exhaustion.

- [ ] **Step 3: Implement exact wire sizing**

Export a helper that produces the same encoded prompt used by providers. Use it in `fits`, `assertFits`, and direct capacity planning with the exact allowed spans. Remove redundant numeric segment data from encoded source rows while retaining lossless label-to-span decoding.

- [ ] **Step 4: Verify green**

Repeat focused tests and expect zero failures.

### Task 5: Replace the production compact hierarchy with a bounded compiler

**Files:**
- Modify: `electron/llm/meetingNotesPipeline.ts`
- Modify: `electron/llm/meetingNotesTypes.ts`
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `tests/unit/meetingNotesTruncationRecovery.test.ts`

- [ ] **Step 1: Write failing bounded-plan tests**

Assert oversized compact input is partitioned once into at most three leaves, each leaf receives one writer and one editor, reviewed leaf documents combine deterministically, and no repair, merge, or repartition stage occurs. Assert a fourth required leaf fails before generation with `notes_bounded_plan_exceeded`. Assert a seventh attempted request fails with `notes_model_call_limit`.

- [ ] **Step 2: Verify red**

Run focused notes tests and confirm the current path reaches hierarchy behavior.

- [ ] **Step 3: Implement the bounded leaf path**

Plan leaves from encoded compact writer/editor fit checks; run the existing no-repair writer and editor per leaf; remap IDs, combine reviewed sections deterministically, re-run conservative mechanical acceptance, and publish metadata as `writer-editor-bounded-v1`. Wrap `generate` with a six-call counter.

- [ ] **Step 4: Verify green**

Repeat focused tests and expect zero failures.

### Task 6: Add the absolute analysis deadline

**Files:**
- Modify: `electron/meetingAnalysisRuns.ts`
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`

- [ ] **Step 1: Write the failing deadline test**

Use fake timers with a provider promise that never settles. Advance twelve minutes, assert the signal aborts, the run records `notes_deadline_exceeded`, and no publication or secondary processing occurs.

- [ ] **Step 2: Verify red**

Run the coordinator test and confirm the run remains active.

- [ ] **Step 3: Implement and clean up the deadline**

Schedule one run-level timer at provider admission, abort with `MeetingNotesError('notes_deadline_exceeded')`, prefer the signal reason when classifying an abort, and clear the timer on every terminal path.

- [ ] **Step 4: Verify green**

Repeat the focused coordinator tests and expect zero failures.

### Task 7: Record and verify the shipped decision

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-04-725-753-speaker-trust-bounded-notes.md`

- [ ] **Step 1: Record the decision and changelog**

Document the independent trust dimensions, anonymous local-speaker behavior, encoded capacity routing, six-call ceiling, and twelve-minute deadline.

- [ ] **Step 2: Run focused and full verification**

Run focused Vitest and Swift suites, `pnpm run typecheck`, `pnpm run lint`, `pnpm run changelog:check`, `pnpm run test -- --run`, and native/package checks required by touched runtime code. Restore Electron SQLite ABI afterward.

- [ ] **Step 3: Run read-only acceptance replays**

Replay affected recordings and note sources without DB writes. Report only content-free cluster counts, trust states, encoded token estimates, planned calls, terminal results, and elapsed time.

- [ ] **Step 4: Update issues and commit**

Comment on #725 and #753 with the verified evidence, commit only scoped files, and report local/remote state without pushing unless separately authorized.
