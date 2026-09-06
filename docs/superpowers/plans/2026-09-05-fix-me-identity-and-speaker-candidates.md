# Resolve Me Speaker Identity and Wire Candidate Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the local microphone speaker (`Me`) automatically resolves to the user's preferred profile name (`Preferred Name (You)`) across both historical and live meetings, and wire cluster evidence into `runFinalTranscription` so speaker candidate embeddings are generated and stored for cross-meeting voice recognition.

**Architecture:** 
1. Relax the origin gate in `getMeetingIdentityContext` (`electron/commitmentIdentity.ts`) so meetings with near-end `Me` turns bind to the configured workspace self person identity even if `capture.origin` is `'unknown'` (historical recordings).
2. Add profile fallback logic in `extractSpeakerDisplayNames` (`src/components/features/meetingTranscriptPresentation.ts`) to map `'Me'` to `identity.profile?.preferredName` or `identity.selfPersonId` when no explicit meeting binding exists.
3. Pass `clusterEvidence` and `provenance` from `speakerEvidence` into `applyRemoteSpeakerClusters` in `src/services/finalTranscription/runFinalTranscription.ts` so `candidateEvidence` is derived and passed to `commitCanonical` for persistence in `meeting_speaker_candidates`.

**Tech Stack:** TypeScript, Electron, React, Vitest, SQLite.

---

### Task 1: Bind Me to workspace self person in `electron/commitmentIdentity.ts`

**Files:**
- Modify: `electron/commitmentIdentity.ts:64-70`
- Test: `tests/unit/commitmentIdentity.test.ts`

- [ ] **Step 1: Write failing test in `tests/unit/commitmentIdentity.test.ts`**
Add a test verifying that when `capture.origin` is `'unknown'` (e.g. historical meetings without capture record) but `workspaceSelfPersonId` is configured and `turns` contain `Me`, `Me` is bound to `workspaceSelfPersonId`.

- [ ] **Step 2: Run test to verify it fails**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/commitmentIdentity.test.ts`
Expected: FAIL with binding not found for 'Me'.

- [ ] **Step 3: Update `electron/commitmentIdentity.ts`**
Allow binding `Me` when `(capture.origin === 'local' || capture.origin === 'unknown')` and `capture.selfPersonId` is a valid person in `people`.

- [ ] **Step 4: Run test to verify it passes**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/commitmentIdentity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git commit -m "fix(identity): bind Me to workspace user for historical meetings with unknown origin"`

---

### Task 2: Add profile and selfPersonId fallback in `extractSpeakerDisplayNames`

**Files:**
- Modify: `src/components/features/meetingTranscriptPresentation.ts:19-46`
- Test: `tests/unit/meetingTranscriptPresentation.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/meetingTranscriptPresentation.test.ts`**
Add tests for `extractSpeakerDisplayNames`:
- Extracts `'Me': 'Deepak'` when `identity.profile.preferredName` is present and no `'Me'` binding exists.
- Extracts `'Me': 'Deepak'` when `identity.selfPersonId` matches a person in `identity.people` and no `'Me'` binding exists.
- Respects explicit `'Me'` binding over `profile.preferredName` if an explicit binding exists.

- [ ] **Step 2: Run test to verify it fails**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/meetingTranscriptPresentation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `extractSpeakerDisplayNames` in `src/components/features/meetingTranscriptPresentation.ts`**
Populate `names['Me']` using `identity.profile?.preferredName` or `peopleById.get(identity.selfPersonId)` if `!names['Me']`.

- [ ] **Step 4: Run test to verify it passes**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/meetingTranscriptPresentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git commit -m "fix(identity): extract Me display name from profile preferredName as fallback"`

---

### Task 3: Wire clusterEvidence and provenance in `runFinalTranscription.ts`

**Files:**
- Modify: `src/services/finalTranscription/runFinalTranscription.ts:368-372`
- Test: `tests/unit/runFinalTranscription.test.ts`

- [ ] **Step 1: Write failing test in `tests/unit/runFinalTranscription.test.ts`**
Add a test verifying that when `speakerEvidence` has `clusterEvidence` and `provenance`, `commitCanonical` receives `speakerCandidates`.

- [ ] **Step 2: Run test to verify it fails**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/runFinalTranscription.test.ts`
Expected: FAIL with `speakerCandidates` undefined or empty.

- [ ] **Step 3: Pass `clusterEvidence` and `provenance` in `applyRemoteSpeakerClusters`**
In `src/services/finalTranscription/runFinalTranscription.ts`:
```typescript
const remoteSpeakers = applyRemoteSpeakerClusters({
  segments: attribution.segments,
  turns: speakerEvidence.turns,
  systemEnergyWindows: speakerEvidence.energyWindows,
  clusterEvidence: speakerEvidence.clusterEvidence,
  provenance: speakerEvidence.provenance,
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/runFinalTranscription.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git commit -m "feat(transcription): pass clusterEvidence and provenance to applyRemoteSpeakerClusters"`

---

### Task 4: Documentation and Verification

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-05-765-me-identity-and-speaker-candidates.md`

- [ ] **Step 1: Update `docs/decisions.md` and create changelog entry**
- [ ] **Step 2: Validate changelog with `pnpm run changelog:check`**
- [ ] **Step 3: Run full linter and tests**
`pnpm run lint && ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/vitest/vitest.mjs run tests/unit/commitmentIdentity.test.ts tests/unit/meetingTranscriptPresentation.test.ts tests/unit/runFinalTranscription.test.ts`
- [ ] **Step 4: Verify the August 27 meeting presentation with script against local DB**
