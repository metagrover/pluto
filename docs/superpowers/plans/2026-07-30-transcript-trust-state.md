# Transcript Trust State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inferred transcript attention messaging with one proof-backed, versioned trust-state pipeline from capture recovery through validation, persistence, UI, and downstream generation.

**Architecture:** Add a pure `transcriptTrustState` module that owns the v2 envelope parser, legacy normalization, projections, resolution, action predicates, and downstream gate. Existing recovery, validation, retry, database, and Meeting View code must construct or consume that contract instead of interpreting partial JSON independently. Preserve the current activity-evidence schema and introduce only the minimal database support required for strict trust mutations and proof-keyed downstream state.

**Tech Stack:** TypeScript, React, Electron, better-sqlite3, Vitest, pnpm

---

### Task 1: Build the strict trust envelope and resolver

**Files:**
- Create: `src/utils/transcriptTrustState.ts`
- Create: `tests/unit/transcriptTrustState.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing state-table tests**

Add table-driven tests that import:

```ts
import {
  parseTranscriptTrustEnvelope,
  resolveTranscriptTrustState,
  buildTranscriptTrustCapabilities,
  canUseTranscriptTrustState,
} from '../../src/utils/transcriptTrustState';
```

Cover:

```ts
it.each([
  ['validated without proof', { schemaVersion: 2, state: 'validated' }],
  ['attention without cause', { schemaVersion: 2, state: 'needs_attention', causes: [] }],
  ['validating without lease', { schemaVersion: 2, state: 'validating', causes: [] }],
  ['unknown cause', {
    schemaVersion: 2,
    state: 'needs_attention',
    causes: [{ code: 'unknown_reason' }],
  }],
])('rejects %s', (_name, envelope) => {
  expect(parseTranscriptTrustEnvelope(JSON.stringify(envelope), projections))
    .toMatchObject({ ok: false });
});
```

Also prove:

- only local/remote unaccounted causes select `speech_unaccounted`;
- gap-free recovery selects `recovered_awaiting_validation`;
- capture gaps outrank transcript coverage;
- a live lease resolves in progress and an expired lease resolves interrupted;
- legacy complete permits `read_existing` but blocks `generate_new`;
- full-mix validation requires mic, system, mix, and activity evidence;
- recovered-channel validation requires every active channel artifact;
- unknown keys, invalid timestamps, invalid digests, non-finite evidence, and
  projection conflicts fail closed.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptTrustState.test.ts
```

Expected: FAIL because `src/utils/transcriptTrustState.ts` does not exist.

- [ ] **Step 3: Implement the strict module**

Create exact public boundaries:

```ts
export const parseTranscriptTrustEnvelope = (
  value: string | null | undefined,
  projections: TranscriptTrustProjections,
): ParseTranscriptTrustEnvelopeResult;

export const resolveTranscriptTrustState = (
  meeting: TranscriptTrustMeetingFields,
  capabilities: TranscriptTrustCapabilities,
  nowMs?: number,
): ResolvedTranscriptTrustState;

export const buildTranscriptTrustCapabilities = (
  input: TranscriptTrustCapabilityInput,
): TranscriptTrustCapabilities;

export const canUseTranscriptTrustState = (
  resolved: ResolvedTranscriptTrustState,
  operation: 'read_existing' | 'generate_new',
): boolean;
```

Reuse `parseCaptureActivityEvidence` and
`parseStoredTranscriptActivityEvidence`. Enforce exact key sets and the spec's
state-specific invariants. Keep UI copy keys and actions as enums; do not put
rendered sentences in this module.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptTrustState.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/transcriptTrustState.ts src/types.ts tests/unit/transcriptTrustState.test.ts
git commit -m "feat: define proof-backed transcript trust state (#556)"
```

### Task 2: Make recovery and validation produce valid v2 state

**Files:**
- Modify: `electron/captureJournalRecovery.ts`
- Modify: `src/utils/recordingFinalization.ts`
- Modify: `src/services/recordingTranscriptValidation.ts`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `src/services/transcriptValidationRetryLease.ts`
- Modify: `tests/unit/captureJournalRecovery.test.ts`
- Modify: `tests/unit/recordingFinalization.test.ts`
- Modify: `tests/unit/recordingTranscriptValidation.test.ts`
- Modify: `tests/unit/retryMeetingTranscriptValidation.test.ts`

- [ ] **Step 1: Write failing producer tests**

Add assertions that:

```ts
expect(parseIntegrity(recoveredMeeting)).toMatchObject({
  schemaVersion: 2,
  state: 'needs_attention',
  causes: [{ code: 'recovered_awaiting_validation' }],
  recovery: { gapDetected: false },
});
```

and:

```ts
expect(parseIntegrity(gappedMeeting)).toMatchObject({
  state: 'needs_attention',
  causes: [{ code: 'capture_gap_detected', sourceScope: 'system' }],
  recovery: { gapDetected: true, sourceScope: 'system' },
});
```

Add retry tests proving recovered-channel mode includes mic and system
transcriptions without a mix, capture gaps cannot claim a validation lease,
retry timeout/failure writes explicit v2 causes, and stale runs cannot mutate
state.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/captureJournalRecovery.test.ts tests/unit/recordingFinalization.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts
```

Expected: FAIL on missing v2 envelope fields and recovered-channel behavior.

- [ ] **Step 3: Implement producer builders**

Add narrow builders in `transcriptTrustState.ts`:

```ts
export const buildRecoveredTranscriptTrustEnvelope = (
  input: RecoveredTranscriptTrustInput,
): TranscriptTrustEnvelopeV2;

export const beginTranscriptValidation = (
  current: TranscriptTrustEnvelopeV2,
  lease: TranscriptValidationRetryLeaseV2,
): TranscriptTrustEnvelopeV2;

export const finishTranscriptValidation = (
  current: TranscriptTrustEnvelopeV2,
  result: TranscriptValidationResultInput,
): TranscriptTrustEnvelopeV2;
```

Route recovery, clean finalization, and retry through these builders. Extend
recording validation with:

```ts
canonicalMode: 'full_mix' | 'recovered_channels';
```

In `recovered_channels`, canonical segments are the time-ordered mic/system
union after existing overlap deduplication. Do not manufacture a mix path.
Reject validation start when a capture gap remains or required active-channel
artifacts/evidence are unavailable.

- [ ] **Step 4: Verify GREEN**

Run the four-test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/transcriptTrustState.ts electron/captureJournalRecovery.ts src/utils/recordingFinalization.ts src/services/recordingTranscriptValidation.ts src/services/retryMeetingTranscriptValidation.ts src/services/transcriptValidationRetryLease.ts tests/unit/captureJournalRecovery.test.ts tests/unit/recordingFinalization.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts
git commit -m "feat: persist explicit transcript trust transitions (#556)"
```

### Task 3: Enforce trust mutations and downstream state in persistence

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/meetingInsertSql.ts`
- Modify: `electron/main.ts`
- Modify: `src/types.ts`
- Create: `tests/unit/transcriptTrustPersistence.test.ts`
- Modify: `tests/unit/meetingInsertSql.test.ts`
- Modify: `tests/unit/dbStopToValidatedLatency.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Test that new recording writes reject:

```ts
{
  transcript_status: 'validated',
  transcript_integrity_json: null,
  transcript_validated_at: null,
}
```

Test that trust transitions reject projection mismatch, while an unrelated
title/favorite update preserves legacy trust bytes exactly. Add database tests
for `downstream_processing_json` and startup repair of malformed/expired
validating leases.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptTrustPersistence.test.ts tests/unit/meetingInsertSql.test.ts tests/unit/dbStopToValidatedLatency.test.ts
```

Expected: FAIL because persistence modes and the downstream column do not exist.

- [ ] **Step 3: Implement persistence modes**

Add `downstream_processing_json TEXT` migration and pass it through meeting
types/SQL. Replace implicit `meeting.transcript_status || 'validated'` behavior
with explicit entry modes:

```ts
type MeetingPersistenceMode =
  | 'create_recording'
  | 'transition_transcript_trust'
  | 'update_transcript_owned_fields'
  | 'update_user_fields'
  | 'update_downstream_fields';
```

Validate v2 state whenever trust fields change. Restrict user-field updates to
their allowlist and downstream updates to proof-matching validated rows.
Repair malformed/expired validating rows to explicit attention state on
startup without changing transcript or derived content.

- [ ] **Step 4: Verify GREEN**

Run the three-test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts electron/meetingInsertSql.ts electron/main.ts src/types.ts tests/unit/transcriptTrustPersistence.test.ts tests/unit/meetingInsertSql.test.ts tests/unit/dbStopToValidatedLatency.test.ts
git commit -m "feat: enforce transcript trust persistence (#556)"
```

### Task 4: Drive Meeting View and downstream gates from the resolver

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`
- Create: `tests/unit/transcriptTrustDownstreamGate.test.ts`

- [ ] **Step 1: Write failing UI and gate tests**

Assert exact user outcomes:

```ts
expect(renderTrust(recovered)).toContain(
  'Recording recovered. Validate the transcript before creating intelligence.',
);
expect(renderTrust(recovered)).not.toContain(
  'could not account for all captured speech',
);
expect(renderTrust(localSpeechMissing)).toContain(
  'could not account for all captured speech',
);
```

Test every resolver action, including no retry for unresolved capture gaps or
unusable artifacts. Test that legacy transcript/intelligence remains readable
but analysis, regeneration, and knowledge generation require proof-backed v2
validation.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/transcriptTrustDownstreamGate.test.ts
```

Expected: FAIL because Meeting View still parses raw JSON and downstream gates
still compare status directly.

- [ ] **Step 3: Implement resolver-driven presentation and gates**

Move copy selection to an exhaustive map keyed by
`ResolvedTranscriptTrustState.copyKey`. Pass only the resolver action to button
rendering. Recompute the same action policy before retry IPC.

Replace:

```ts
transcriptStatus == null || transcriptStatus === 'validated'
```

with operation-specific `canUseTranscriptTrustState`. Start and finish
`downstream_processing_json` runs around derived generation without changing a
validated transcript envelope on downstream failure.

- [ ] **Step 4: Verify GREEN**

Run the two-test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/MeetingView.tsx src/components/AudioManager.tsx src/services/retryMeetingTranscriptValidation.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/transcriptTrustDownstreamGate.test.ts
git commit -m "fix: render transcript trust from explicit causes (#556)"
```

### Task 5: Add benchmark coverage and durable documentation

**Files:**
- Modify: `src/services/recordingQualityBenchmark.ts`
- Modify: `tests/unit/recordingQualityBenchmark.test.ts`
- Modify: `scripts/recording-quality/manifest.json`
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-07-30-556-transcript-trust-state.md`

- [ ] **Step 1: Write failing benchmark test**

Add synthetic cases for:

```ts
[
  'recovered_awaiting_validation',
  'capture_gap_detected',
  'local_speech_unaccounted',
  'remote_speech_unaccounted',
  'validation_retry_failed',
  'validation_state_corrupt',
]
```

Assert reports include only fixture ID, resolved kind, copy key, action, and
pass/fail result; no text, names, or paths.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
```

Expected: FAIL because transcript-trust benchmark cases are not supported.

- [ ] **Step 3: Implement benchmark and docs**

Add a `transcript_trust_state` synthetic benchmark kind that calls the pure
resolver. Record the v2 authority and legacy generation boundary in
`docs/decisions.md`.

Create the changelog fragment with:

```md
- **Issue:** #556
- **PR:** Pending
- **Changed:** Transcript trust now uses an explicit proof-backed state contract.
- **Why:** Recovery-only or unknown state could masquerade as confirmed missing speech.
- **Replaced:** Ad hoc status and JSON interpretation across producers and Meeting View.
- **Notes:** Legacy meetings remain readable; new derived generation requires v2 validation proof.
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/recordingQualityBenchmark.test.ts
pnpm run recording-quality:pr
pnpm run changelog:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recordingQualityBenchmark.ts tests/unit/recordingQualityBenchmark.test.ts scripts/recording-quality/manifest.json docs/decisions.md docs/changelog/entries/2026-07-30-556-transcript-trust-state.md
git commit -m "test: gate transcript trust state regressions (#556)"
```

### Task 6: Full verification and delivery

**Files:**
- Review: all files changed since `origin/master`

- [ ] **Step 1: Run focused trust pipeline tests**

```bash
pnpm exec vitest run tests/unit/transcriptTrustState.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/captureJournalRecovery.test.ts tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/recordingFinalization.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/transcriptTrustPersistence.test.ts tests/unit/transcriptTrustDownstreamGate.test.ts tests/unit/transcriptSchema.test.ts tests/unit/dbStopToValidatedLatency.test.ts tests/unit/recordingQualityBenchmark.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository gates**

```bash
pnpm run recording-quality:pr
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
git diff --check origin/master...HEAD
```

Expected: all commands PASS.

- [ ] **Step 3: Review the complete diff**

```bash
git diff --stat origin/master...HEAD
git diff origin/master...HEAD
```

Confirm every changed line maps to #556, no meeting content or local paths are
present, no implicit validation fallback remains, and the original recovered
meeting scenario resolves honestly.

- [ ] **Step 4: Update issue and open PR**

Push the branch, update #556 with verification results and durable decisions,
and open a PR that links #556 and lists the exact tests and benchmark gates.
