# Remote Participant Diarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate trusted system-audio speech into stable anonymous remote speakers and let users resolve those labels from the transcript.

**Architecture:** Keep recovered-channel attribution authoritative for `Me`, run FluidAudio clustering on system audio only, then apply a second fail-closed word-alignment pass exclusively to accepted `Them` segments. Preserve anonymous labels in canonical transcript JSON and project reversible meeting identity bindings into display names.

**Tech Stack:** Swift/FluidAudio/CoreML, TypeScript, React, Electron IPC, Vitest/XCTest.

---

### Task 1: Route diarization to the isolated system recording

**Files:**
- Modify: `native/parakeet-runtime/Sources/ParakeetRuntimeEngine/SpeakerEvidence.swift`
- Test: `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift`

- [x] Add a capturing diarizer test that records the URL supplied by `SpeakerEvidenceCoordinator` and assert it is `system.wav`, not `mixed.wav`.
- [x] Run the focused Swift test and confirm it fails against the mixed-audio call.
- [x] Change only the coordinator's diarizer input to `systemURL`; retain mic/system energy analysis and the protocol shape for compatibility.
- [x] Run the focused Swift test and the native runtime suite.

### Task 2: Align system clusters to Parakeet words with a fail-closed fallback

**Files:**
- Create: `src/services/finalTranscription/applyRemoteSpeakerClusters.ts`
- Modify: `src/utils/transcriptSchema.ts`
- Test: `tests/unit/applyRemoteSpeakerClusters.test.ts`

- [x] Write failing tests for deterministic `Remote Speaker N` numbering, word-level speaker-boundary splits, untouched `Me`/`Unknown` turns, sub-second cluster suppression, overlapping remote speakers, and less-than-80-percent coverage fallback.
- [x] Run the focused Vitest file and confirm the missing module failure.
- [x] Implement a pure alignment function that validates diarization intervals, drops clusters with under one second of total support, orders supported clusters by first appearance, maps words by maximum temporal overlap, and publishes labels only with at least two clusters and 0.8 system-speech coverage.
- [x] Add content-free `remoteDiarization` metadata to `StoredTranscriptSpeakerAttribution`, including attempt/application state, confidence, cluster count, labeled segment count, and fallback reason.
- [x] Run the focused tests and transcript-schema tests.

### Task 3: Persist remote labels after source-authoritative attribution

**Files:**
- Modify: `src/services/finalTranscription/runFinalTranscription.ts`
- Test: `tests/unit/runFinalTranscription.test.ts`
- Test: `tests/unit/runPersistedMeetingFinalTranscription.test.ts`

- [x] Write failing finalization tests proving that accepted system segments become anonymous remote labels, `Me` remains unchanged, low-confidence evidence stays `Them`, and persisted metadata records the fallback/application result.
- [x] Run the focused tests and confirm the new expectations fail.
- [x] Invoke remote cluster alignment only after recovered-channel evidence is accepted, merge its metadata into the verified speaker-attribution record, and commit the aligned segments.
- [x] Run final-transcription, persistence, trust, and downstream-gating tests.

### Task 4: Project confirmed identities across the transcript and offer calendar choices

**Files:**
- Modify: `src/components/features/MeetingIdentityControls.tsx`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/features/meetingTranscriptPresentation.ts`
- Test: `tests/unit/IdentityControls.dom.test.tsx`
- Test: `tests/unit/meetingTranscriptPresentation.test.ts`
- Test: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [x] Write failing tests showing that confirmed bindings resolve all matching transcript turns, anonymous labels remain when unbound, and unique calendar attendees appear as direct mapping choices while ambiguous names do not.
- [x] Run the focused DOM and presentation tests and confirm failure.
- [x] Load meeting identity state when the transcript controls mount, expose binding display names to the parent, and add remote-speaker-only calendar choice buttons that use a unique existing person or create a distinct person when absent.
- [x] Apply display names while building presentation turns without mutating canonical segments; refresh the mapping immediately after save or clear.
- [x] Run focused identity, transcript, Meeting View, calendar, and accessibility tests.

### Task 5: Record delivery, verify, review, and raise the PR

**Files:**
- Add: `docs/changelog/entries/2026-09-04-749-remote-participant-diarization.md`
- Modify: `docs/decisions.md` only if implementation changes a durable boundary beyond this approved design.

- [x] Add a changelog fragment linking #749 and describing system-only clustering, safe fallback, reversible identity projection, and local-only privacy.
- [x] Run `pnpm run changelog:check`, focused Vitest suites, full `pnpm test -- --run`, `pnpm exec tsc --noEmit`, `pnpm run check`, `swift test --package-path native/parakeet-runtime`, relevant builds, and `git diff --check`.
- [x] Review the complete diff against every acceptance criterion and correct Critical or Important findings.
- [ ] Commit focused changes, refresh `origin/master`, rebase if needed, rerun affected verification, push `codex/749-remote-diarization`, and create a PR that links and closes #749.
