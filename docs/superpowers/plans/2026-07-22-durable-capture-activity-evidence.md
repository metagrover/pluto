# Durable Capture Activity Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one canonical, content-free capture-activity envelope so clean finalization, crash recovery, and every retry consume the exact same verified windows and digest.

**Architecture:** A browser-safe TypeScript codec owns v2 normalization, canonical JSON, Web Crypto SHA-256, and strict parsing while preserving the existing v1 meeting reader. Capture-journal v2 stores that envelope beside ordered audio entries, IPC updates it through the renderer's existing write queue, and sealing returns the durable envelope only after a persistent failure latch is clear. Finalization, recovery, and retry copy and verify the envelope rather than rebuilding it from mutable speaker state.

**Tech Stack:** TypeScript, React/Electron IPC, Node `crypto`/`fs`, Vitest, pnpm

---

## File map

- Modify `src/utils/transcriptActivityEvidence.ts`: define the canonical v2 envelope, strict normalization/parser, canonical serializer, digest builder/verifier, and legacy v1 parser.
- Modify `tests/unit/transcriptActivityEvidence.test.ts`: deterministic serialization/digest and strict malformed/unsupported/corrupt cases.
- Modify `electron/captureJournal.ts`: discriminate v1/v2 manifests, create v2 journals, durably update evidence, require verified evidence at seal, and return the durable identity.
- Modify `tests/unit/captureJournal.test.ts`: compatibility, snapshot durability, seal identity, and fail-closed schema cases.
- Modify `electron/main.ts`: add the activity-snapshot IPC handler and transport the sealed manifest result.
- Modify `src/utils/recordingFinalization.ts`: model a persistent queue failure latch and return the sealed envelope from the finalization boundary.
- Modify `tests/unit/recordingFinalization.test.ts`: prove earlier audio/evidence failures prevent sealing even after later success.
- Modify `src/components/AudioManager.tsx`: enqueue a snapshot whenever a speaker window closes, flush the final window at frozen stop time, latch failures, and reuse the sealed envelope for validation/persistence.
- Create `tests/unit/captureActivitySession.test.ts`: test the extracted session queue/window orchestration without mounting the large component.
- Create `src/utils/captureActivitySession.ts`: focused ordered-session state machine used by `AudioManager`.
- Modify `electron/captureJournalRecovery.ts`: import verified v2 evidence and explicitly label v1 as legacy uncertainty.
- Modify `tests/unit/captureJournalRecovery.test.ts`: exact recovered payload/digest and distinct v2 evidence failures.
- Modify `src/services/retryMeetingTranscriptValidation.ts`: verify v2 persisted evidence, fail closed by reason, and retain explicit legacy fallback.
- Modify `tests/unit/retryMeetingTranscriptValidation.test.ts`: exact v2 retry identity plus missing/corrupt/unsupported cases.
- Modify `src/utils/transcriptIntegrity.ts`: add content-free v2 failure reasons.
- Modify `src/utils/browserIpcFallback.ts`: support the new journal-update channel in browser preview consistently with existing journal no-ops.
- Modify `docs/changelog/entries/2026-07-22-445-durable-capture-activity-evidence-design.md`: replace `PR: Pending` and describe shipped behavior once the PR exists.

### Task 1: Canonical v2 evidence codec

**Files:**
- Modify: `src/utils/transcriptActivityEvidence.ts`
- Test: `tests/unit/transcriptActivityEvidence.test.ts`

- [ ] **Step 1: Write failing deterministic and strict-parser tests**

Add tests using this concrete producer and deliberately reordered windows:

```ts
const producer = {
  clock: { kind: 'meeting_relative_seconds' as const, origin: 'recording_start' as const },
  thresholds: { rms: 0.012, dominanceRatio: 1.25, minimumSwitchIntervalMs: 200 },
  algorithmVersion: 'speaker_activity_v1',
};

const first = await buildCaptureActivityEvidence([
  { startTime: 2.5, endTime: 4, speaker: 'Them' },
  { startTime: 0, endTime: 2.5, speaker: 'Me' },
], producer);
const second = await buildCaptureActivityEvidence([...first.windows].reverse(), producer);
expect(first).toEqual(second);
expect(first.digestSha256).toMatch(/^[a-f0-9]{64}$/);
await expect(verifyCaptureActivityEvidence(first)).resolves.toEqual(first);
```

Also assert that negative, non-finite, zero-length, overlapping same-speaker windows, unknown source/schema/serialization versions, and a changed digest each return the exact status `malformed`, `unsupported`, or `digest_mismatch`; do not silently filter invalid v2 windows. Keep the existing v1 round-trip test.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run tests/unit/transcriptActivityEvidence.test.ts`

Expected: FAIL because `buildCaptureActivityEvidence` and `verifyCaptureActivityEvidence` are not exported.

- [ ] **Step 3: Implement the canonical types and codec**

Add these public shapes and APIs:

```ts
export const CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION = 2;
export const CAPTURE_ACTIVITY_SERIALIZATION_VERSION = 1;
export type CaptureActivityEvidence = {
  schemaVersion: 2;
  source: 'capture_activity_v2';
  clock: { kind: 'meeting_relative_seconds'; origin: 'recording_start' };
  thresholds: { rms: number; dominanceRatio: number; minimumSwitchIntervalMs: number };
  algorithmVersion: 'speaker_activity_v1';
  serializationVersion: 1;
  windows: StoredTranscriptActivityWindow[];
  digestSha256: string;
};
export type CaptureActivityParseResult =
  | { ok: true; evidence: CaptureActivityEvidence }
  | { ok: false; reason: 'malformed' | 'unsupported' | 'digest_mismatch' };
export const canonicalizeCaptureActivityPayload = (
  evidence: Omit<CaptureActivityEvidence, 'digestSha256'>,
): string => JSON.stringify({
  schemaVersion: evidence.schemaVersion,
  source: evidence.source,
  clock: evidence.clock,
  thresholds: evidence.thresholds,
  algorithmVersion: evidence.algorithmVersion,
  serializationVersion: evidence.serializationVersion,
  windows: evidence.windows,
});
```

Do not import `node:crypto` or any Node global into this renderer-imported module. Compute SHA-256 asynchronously with `globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))`, then encode the bytes as lowercase hexadecimal. Make `buildCaptureActivityEvidence`, `parseCaptureActivityEvidence`, and `verifyCaptureActivityEvidence` async. Normalize by validating every number before sorting on `startTime`, then `endTime`, then speaker; reject duplicate/overlapping windows for the same speaker instead of dropping data. `buildCaptureActivityEvidence` rejects invalid producer input/windows. `parseCaptureActivityEvidence(value)` resolves to the discriminated result and `verifyCaptureActivityEvidence(value)` resolves to the evidence or rejects with a content-free error containing only the result reason. Leave `buildStoredTranscriptActivityEvidence`/`parseStoredTranscriptActivityEvidence` intact for legacy meetings.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/transcriptActivityEvidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the codec**

```bash
git add src/utils/transcriptActivityEvidence.ts tests/unit/transcriptActivityEvidence.test.ts
git commit -m "feat: add canonical capture activity evidence"
```

### Task 2: Capture-journal v2 persistence and seal identity

**Files:**
- Modify: `electron/captureJournal.ts`
- Test: `tests/unit/captureJournal.test.ts`

- [ ] **Step 1: Add failing v1/v2 journal contract tests**

Test that new journals are v2 with optional recording evidence, `updateCaptureJournalActivityEvidence(root, { meetingId, activityEvidence })` durably writes and returns it, duplicate identical snapshots are idempotent, older snapshots cannot replace newer windows, and `sealCaptureJournal` returns a v2 sealed manifest with exactly the persisted object/digest. Create a v1 JSON fixture directly and assert it remains readable. Mutate v2 fixtures to prove sealed missing evidence and malformed/unsupported/digest mismatch throw respectively:

```ts
await expect(sealCaptureJournal(root, {
  meetingId: 'meeting-123', endedAtMs: 6_000,
})).rejects.toThrow('capture_activity_missing');
expect(sealed.activityEvidence).toEqual(snapshot);
expect(sealed.activityEvidence?.digestSha256).toBe(snapshot.digestSha256);
```

- [ ] **Step 2: Run capture-journal tests and verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`

Expected: FAIL because schema v2 and the update API do not exist.

- [ ] **Step 3: Implement discriminated manifests and durable update**

Define:

```ts
export type CaptureJournalManifestV1 = CaptureJournalBase & { schemaVersion: 1 };
export type CaptureJournalManifestV2 = CaptureJournalBase & {
  schemaVersion: 2;
  activityEvidence?: CaptureActivityEvidence;
};
export type CaptureJournalManifest = CaptureJournalManifestV1 | CaptureJournalManifestV2;
export const updateCaptureJournalActivityEvidence = async (
  rootDir: string,
  args: { meetingId: string; activityEvidence: CaptureActivityEvidence },
  durability: CaptureJournalDurability = defaultDurability,
): Promise<CaptureJournalManifestV2>;
```

New creation emits schema 2. Validation branches explicitly on `schemaVersion`; v1 has no evidence requirement, while every present v2 envelope awaits `parseCaptureActivityEvidence`. The journal reader already returns a promise, so digest verification must complete before it returns. Reject snapshot replacement when its final window ends before the stored final window or when equal window count carries a different digest. At seal, reject v1 mutation (legacy manifests remain readable but new code does not upgrade them), require v2 verified evidence, persist sealed state, re-read the manifest, and return that re-read durable object.

- [ ] **Step 4: Run capture-journal tests and verify GREEN plus regression coverage**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`

Expected: PASS, including existing checksum, idempotency, path-boundary, and sync-order tests.

- [ ] **Step 5: Commit journal v2**

```bash
git add electron/captureJournal.ts tests/unit/captureJournal.test.ts
git commit -m "feat: persist activity evidence in capture journals"
```

### Task 3: Ordered renderer session and persistent failure latch

**Files:**
- Create: `src/utils/captureActivitySession.ts`
- Create: `tests/unit/captureActivitySession.test.ts`
- Modify: `src/utils/recordingFinalization.ts`
- Modify: `tests/unit/recordingFinalization.test.ts`

- [ ] **Step 1: Write failing queue/latch/final-window tests**

Cover ordering `audio -> snapshot -> audio -> final snapshot -> seal`, a rejected audio append followed by successful work, a rejected snapshot, and an active `Them` window closed at frozen end `8.25`. Assert no failure case calls seal and every failure returns `recovery_required`.

```ts
const session = createCaptureActivitySession({ producer, persistSnapshot });
session.openWindow('Them', 5);
await session.closeAt(8.25);
expect(persistSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
  windows: [{ startTime: 5, endTime: 8.25, speaker: 'Them' }],
}));
expect(session.hasDurabilityFailure()).toBe(false);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run tests/unit/captureActivitySession.test.ts tests/unit/recordingFinalization.test.ts`

Expected: FAIL because the session helper and latch-aware finalizer do not exist.

- [ ] **Step 3: Implement the small session state machine**

Export `createCaptureActivitySession({ producer, persistSnapshot })` with `enqueue(task)`, `transitionSpeaker(next, seconds)`, `closeAt(seconds)`, `drain()`, `hasDurabilityFailure()`, and `windows()`. All work chains through one promise; its catch sets a boolean latch that is never reset and logs no task data. Closing a valid window builds and enqueues the complete canonical snapshot.

Change finalization to:

```ts
export type JournalSealResult =
  | { status: 'sealed'; activityEvidence: CaptureActivityEvidence }
  | { status: 'recovery_required'; reason: 'capture_journal_write_failed' | 'capture_journal_seal_failed' };

export const sealCaptureJournalBeforeFinalization = async ({
  drainAppends, hasWriteFailure, seal,
}: {
  drainAppends: () => Promise<void>;
  hasWriteFailure: () => boolean;
  seal: () => Promise<{ activityEvidence?: CaptureActivityEvidence }>;
}): Promise<JournalSealResult>;
```

Drain, check the latch, call seal, verify the returned envelope, and reduce errors to content-free categories.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureActivitySession.test.ts tests/unit/recordingFinalization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit ordered session logic**

```bash
git add src/utils/captureActivitySession.ts tests/unit/captureActivitySession.test.ts src/utils/recordingFinalization.ts tests/unit/recordingFinalization.test.ts
git commit -m "feat: latch capture journal write failures"
```

### Task 4: IPC and AudioManager sealed-payload handoff

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/utils/browserIpcFallback.ts`
- Test: `tests/unit/captureActivitySession.test.ts`

- [ ] **Step 1: Extend the integration test with exact identity assertions**

Add a test which captures the final `activityEvidence` returned by fake seal and asserts the same object/digest is supplied to initial validation integrity and persistence adapters. It must assert a mutable post-seal window change has no effect.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `pnpm exec vitest run tests/unit/captureActivitySession.test.ts`

Expected: FAIL because no sealed-payload handoff adapter exists.

- [ ] **Step 3: Add update IPC and wire AudioManager**

Import `updateCaptureJournalActivityEvidence` in `electron/main.ts` and register `AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE`, passing only `meetingId` and `activityEvidence`; do not coerce malformed payloads. Make browser preview return the submitted envelope for this channel.

In `AudioManager`, initialize the session with:

```ts
const producer = {
  clock: { kind: 'meeting_relative_seconds', origin: 'recording_start' },
  thresholds: {
    rms: TRANSCRIPTION_TUNING.speaking.rmsThreshold,
    dominanceRatio: TRANSCRIPTION_TUNING.speaking.ratio,
    minimumSwitchIntervalMs: TRANSCRIPTION_TUNING.speaking.minIntervalMs,
  },
  algorithmVersion: 'speaker_activity_v1',
} as const;
```

Route both audio appends and evidence updates through the session queue. Replace direct window pushes with `transitionSpeaker`. On stop, call `closeAt(frozenDurationSeconds)`, then the latch-aware finalizer. If sealed, use `journalSealOutcome.activityEvidence.windows` in `runRecordingTranscriptValidation` and place the exact `journalSealOutcome.activityEvidence` plus source `capture_activity_v2` into every meeting integrity construction at the current three save paths. Remove finalization-time calls to `buildStoredTranscriptActivityEvidence`; retain it only for legacy code. On any latched failure preserve the existing recovery-required save/artifacts and skip validation/normal finalization.

- [ ] **Step 4: Run focused tests, lint the touched integration, and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureActivitySession.test.ts tests/unit/recordingFinalization.test.ts tests/unit/captureJournal.test.ts`

Run: `pnpm run lint`

Expected: all PASS with no lint errors.

- [ ] **Step 5: Commit IPC and renderer integration**

```bash
git add electron/main.ts src/components/AudioManager.tsx src/utils/browserIpcFallback.ts tests/unit/captureActivitySession.test.ts
git commit -m "feat: seal durable activity evidence before validation"
```

### Task 5: Crash recovery imports verified evidence

**Files:**
- Modify: `electron/captureJournalRecovery.ts`
- Modify: `tests/unit/captureJournalRecovery.test.ts`
- Modify: `src/utils/transcriptIntegrity.ts`

- [ ] **Step 1: Write failing recovery compatibility and corruption tests**

Create recording v2 journals with valid evidence and assert recovered integrity contains byte-for-byte equivalent `activityEvidence`, its digest, and `activityEvidenceSource: 'capture_activity_v2'`. Add direct fixtures for v1 (`legacy_provisional_segments`) and v2 missing/malformed/unsupported/digest mismatch; assert distinct content-free reasons and `needs_attention`, never provisional windows.

- [ ] **Step 2: Run recovery tests and verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournalRecovery.test.ts`

Expected: FAIL because recovery does not import evidence.

- [ ] **Step 3: Implement explicit recovery evidence classification**

Extend `TranscriptIntegrityReason` with:

```ts
| 'capture_activity_missing'
| 'capture_activity_corrupt'
| 'capture_activity_unsupported'
| 'capture_journal_write_failed'
```

Extend `RecoveryMeetingIntegrity` with `activityEvidenceSource`, optional `activityEvidence`, and content-free `reasons`. For v1 set source `legacy_provisional_segments` and include `capture_activity_missing` as uncertainty without rejecting audio recovery. For v2 map parse results: absent -> missing, unsupported -> unsupported, malformed/digest mismatch -> corrupt; only a verified envelope is copied into integrity. Never include raw parser errors or paths in reasons.

- [ ] **Step 4: Run recovery and journal suites and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournalRecovery.test.ts tests/unit/captureJournal.test.ts`

Expected: PASS, including recovery isolation and artifact checksum tests.

- [ ] **Step 5: Commit recovery import**

```bash
git add electron/captureJournalRecovery.ts tests/unit/captureJournalRecovery.test.ts src/utils/transcriptIntegrity.ts
git commit -m "feat: recover durable capture activity evidence"
```

### Task 6: Deterministic retry reader

**Files:**
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `tests/unit/retryMeetingTranscriptValidation.test.ts`

- [ ] **Step 1: Write failing v2 retry identity and fail-closed tests**

Store a valid sealed envelope in `transcript_integrity_json`, retry, and assert validation receives the exact windows and the saved integrity retains exactly the original envelope/digest. Add table cases for missing, malformed, unsupported, and digest mismatch which assert `needs_attention`, the corresponding reason, and no provisional-segment fallback. Retain a legacy no-envelope test that still uses provisional segments with source `legacy_provisional_segments`.

- [ ] **Step 2: Run retry tests and verify RED**

Run: `pnpm exec vitest run tests/unit/retryMeetingTranscriptValidation.test.ts`

Expected: FAIL because v2 is not parsed.

- [ ] **Step 3: Implement the explicit v2/legacy reader**

Update the return source union to include `capture_activity_v2` and `capture_activity_unsupported`. If `activityEvidenceSource` declares v2, require `parseCaptureActivityEvidence` success and map failures without fallback. If verified, pass `evidence.windows` and copy the unchanged `evidence` into completed integrity. Continue parsing `capture_activity_v1` with the existing reader and permit provisional fallback only when the record does not declare v1/v2 capture evidence.

- [ ] **Step 4: Run evidence, retry, and validation suites and verify GREEN**

Run: `pnpm exec vitest run tests/unit/transcriptActivityEvidence.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/recordingTranscriptValidation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit retry support**

```bash
git add src/services/retryMeetingTranscriptValidation.ts tests/unit/retryMeetingTranscriptValidation.test.ts
git commit -m "feat: verify capture activity evidence on retry"
```

### Task 7: Changelog and end-to-end verification

**Files:**
- Modify: `docs/changelog/entries/2026-07-22-445-durable-capture-activity-evidence-design.md`

- [ ] **Step 1: Update the existing changelog fragment**

Keep the issue link, set the actual PR after creation, change the heading to `Persist durable capture activity evidence`, and state that v2 journals incrementally persist evidence, seal fails closed after any write failure, and initial/recovery/retry paths reuse the verified digest. Do not include local paths, recordings, names, transcript text, or credentials.

- [ ] **Step 2: Run focused trust suites**

Run:

```bash
pnpm exec vitest run \
  tests/unit/transcriptActivityEvidence.test.ts \
  tests/unit/captureActivitySession.test.ts \
  tests/unit/captureJournal.test.ts \
  tests/unit/captureJournalRecovery.test.ts \
  tests/unit/recordingFinalization.test.ts \
  tests/unit/recordingTranscriptValidation.test.ts \
  tests/unit/retryMeetingTranscriptValidation.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the recording-quality PR benchmark**

Run: `pnpm run benchmark:recording-quality -- --tier pr`

Expected: PASS with no regression beyond the checked-in PR-tier envelope.

- [ ] **Step 4: Run repository gates**

Run, separately:

```bash
pnpm run changelog:check
pnpm run lint
pnpm run test
pnpm run audit:high
```

Expected: all PASS. If the audit reports a pre-existing vulnerability, do not bypass the hook for this code change; stop and report it under the Builder audit policy.

- [ ] **Step 5: Run privacy and scope checks**

Run:

```bash
git diff --check
git diff --name-only master...HEAD
git diff master...HEAD | rg -n '/Users/|GH_TOKEN|BEGIN (RSA|OPENSSH)|transcript text|participant' || true
git status --short
```

Expected: no whitespace errors, only files listed by this plan plus the approved spec/changelog, no private content or credentials, and no generated junk.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/changelog/entries/2026-07-22-445-durable-capture-activity-evidence-design.md
git commit -m "docs: record durable capture activity delivery"
```

- [ ] **Step 7: Prepare PR and issue evidence**

Push `codex/445-durable-capture-activity-evidence`, open the PR against `master` with `Closes #445`, list all verification commands/results and the v1 uncertainty/v2 fail-closed limitation, then comment on #445 with the PR link and the same content-free verification summary. Do not include local paths, fixtures derived from recordings, transcripts, participant identities, or credentials.
