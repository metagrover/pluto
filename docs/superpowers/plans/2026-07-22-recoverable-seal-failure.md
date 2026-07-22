# Recoverable Capture-Journal Seal Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a visible `recovery_required` meeting and its capture journal when sealing fails, without claiming successful transcript or analysis finalization.

**Architecture:** Add an explicit meeting finalization lifecycle to the existing SQLite meeting record, construct the degraded record through a pure tested helper, and move capture-journal sealing ahead of queued transcription and all derived finalization in `AudioManager`. Meeting View renders the recovery state and blocks finalized-evidence consumers until recovery succeeds.

**Tech Stack:** React 18, TypeScript, Electron IPC, better-sqlite3, Vitest, Testing Library.

---

## File Map

- `src/types.ts`: shared `MeetingFinalizationStatus` and meeting fields consumed by the renderer.
- `electron/db.ts`: persisted meeting fields plus additive migration for existing databases.
- `electron/meetingInsertSql.ts`: insert/update column contract for finalization state.
- `tests/unit/meetingInsertSql.test.ts`: SQL column/placeholder regression coverage.
- `src/utils/recordingFinalization.ts`: pure construction of the degraded meeting payload and finalized-evidence eligibility.
- `tests/unit/recordingFinalization.test.ts`: ordering-independent payload, privacy, and status tests.
- `src/components/AudioManager.tsx`: append-drain, seal-first branching, degraded save, and early return before derived work.
- `src/components/features/MeetingView.tsx`: visible recovery-required panel and intelligence gating.
- `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`: recovery copy and gating coverage.
- `docs/decisions.md`: durable “fail closed on trust, not preservation” decision.
- `docs/changelog/entries/2026-07-22-535-recoverable-seal-failure.md`: shipped behavior and traceability.

### Task 1: Persist an explicit meeting-finalization lifecycle

**Files:**
- Modify: `src/types.ts`
- Modify: `electron/db.ts`
- Modify: `electron/meetingInsertSql.ts`
- Test: `tests/unit/meetingInsertSql.test.ts`

- [ ] **Step 1: Write the failing SQL-contract test**

Add assertions that the insert contains `finalization_status` and `finalization_error_category` while retaining equal column and placeholder counts:

```ts
expect(columns).toContain('finalization_status');
expect(columns).toContain('finalization_error_category');
expect(countMatches(MEETING_INSERT_SQL, /\?/g)).toBe(columns?.length ?? 0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/meetingInsertSql.test.ts`

Expected: FAIL because neither finalization column exists.

- [ ] **Step 3: Add the shared lifecycle type and meeting fields**

In `src/types.ts`, add:

```ts
export type MeetingFinalizationStatus = 'finalized' | 'recovery_required';
```

Add to `Meeting`:

```ts
finalization_status?: MeetingFinalizationStatus;
finalization_error_category?: 'journal_seal_failed' | null;
```

In `electron/db.ts`, import or duplicate the type through the existing type-import pattern and add the same nullable fields to `PersistedMeeting`.

- [ ] **Step 4: Add schema creation and additive migration**

Add these columns to the initial `meetings` schema:

```sql
finalization_status TEXT NOT NULL DEFAULT 'finalized',
finalization_error_category TEXT,
```

In the optional meeting-column migration block add:

```ts
if (!meetingColumns.some((col) => col.name === 'finalization_status')) {
  db.exec(
    "ALTER TABLE meetings ADD COLUMN finalization_status TEXT NOT NULL DEFAULT 'finalized'",
  );
}
if (!meetingColumns.some((col) => col.name === 'finalization_error_category')) {
  db.exec(
    'ALTER TABLE meetings ADD COLUMN finalization_error_category TEXT',
  );
}
```

- [ ] **Step 5: Extend insert SQL and bindings**

Insert `finalization_status, finalization_error_category` immediately before `created_at` in `MEETING_INSERT_SQL`, add two placeholders, and bind:

```ts
meeting.finalization_status || 'finalized',
meeting.finalization_error_category || null,
meeting.created_at,
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/meetingInsertSql.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the persistence contract**

```bash
git add src/types.ts electron/db.ts electron/meetingInsertSql.ts tests/unit/meetingInsertSql.test.ts
git commit -m "feat: persist meeting finalization state (#535)"
```

### Task 2: Define the degraded meeting payload as pure logic

**Files:**
- Modify: `src/utils/recordingFinalization.ts`
- Test: `tests/unit/recordingFinalization.test.ts`

- [ ] **Step 1: Write failing degraded-payload tests**

Import `buildRecoverableSealFailureMeeting` and add tests asserting the complete payload and absence of sensitive error detail:

```ts
const meeting = buildRecoverableSealFailureMeeting({
  snapshot: {
    meetingId: 'meeting-1',
    recordingStartedAtMs: Date.parse('2026-07-22T20:00:00.000Z'),
    recordingEndedAtMs: Date.parse('2026-07-22T20:05:30.000Z'),
  },
  title: 'Design review',
  userNotes: 'Keep this note',
  endReason: 'manual',
});

expect(meeting).toMatchObject({
  id: 'meeting-1',
  title: 'Design review',
  meeting_type: 'Recording',
  duration_seconds: 330,
  transcript_status: 'needs_attention',
  finalization_status: 'recovery_required',
  finalization_error_category: 'journal_seal_failed',
  transcript_json: '[]',
  user_notes: 'Keep this note',
});
expect(meeting.transcript_integrity_json).toBe(
  JSON.stringify({ reasons: ['journal_seal_failed'] }),
);
expect(JSON.stringify(meeting)).not.toContain('/');
```

Also prove the fallback title is `Meeting` and `end_reason` is `journal_seal_failed` when no explicit end reason exists.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/recordingFinalization.test.ts`

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Implement the minimal pure helper**

Add:

```ts
export const buildRecoverableSealFailureMeeting = ({
  snapshot,
  title,
  userNotes,
  endReason,
}: {
  snapshot: RecordingStopSnapshot;
  title?: string;
  userNotes?: string;
  endReason?: string;
}) => {
  const timing = buildMeetingTiming(snapshot);
  return {
    id: snapshot.meetingId,
    title: title?.trim() || 'Meeting',
    meeting_type: 'Recording',
    started_at: timing.startedAtIso,
    ended_at: timing.endedAtIso,
    duration_seconds: timing.durationSeconds,
    audio_path: null,
    system_audio_path: null,
    mixed_audio_path: null,
    transcript_status: 'needs_attention' as const,
    transcript_integrity_json: JSON.stringify({
      reasons: ['journal_seal_failed'],
    }),
    transcript_validated_at: null,
    transcript_json: JSON.stringify([]),
    user_notes: userNotes || '',
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    finalization_status: 'recovery_required' as const,
    finalization_error_category: 'journal_seal_failed' as const,
    folder_id: null,
    is_favorite: false,
    end_reason: endReason || 'journal_seal_failed',
  };
};
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/recordingFinalization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the degraded-state helper**

```bash
git add src/utils/recordingFinalization.ts tests/unit/recordingFinalization.test.ts
git commit -m "test: define recoverable seal failure payload (#535)"
```

### Task 3: Seal before any derived finalization and save degradation once

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Test: `tests/unit/recordingFinalization.test.ts`

- [ ] **Step 1: Write a failing seal-boundary ordering test**

Import `sealCaptureJournalBeforeFinalization`, record dependency calls, and prove seal waits for the append drain:

```ts
const events: string[] = [];
const outcome = await sealCaptureJournalBeforeFinalization({
  drainAppends: async () => {
    events.push('drain');
  },
  seal: async () => {
    events.push('seal');
  },
});

expect(events).toEqual(['drain', 'seal']);
expect(outcome).toBe('sealed');
```

Add a failure test whose thrown error contains transcript text and a filesystem path, and assert that the returned value is only `recovery_required`.

- [ ] **Step 2: Run the ordering test and verify RED**

Run and expect a missing-export failure:

`pnpm exec vitest run tests/unit/recordingFinalization.test.ts`

- [ ] **Step 3: Implement the dependency-injected seal boundary**

In `recordingFinalization.ts`, export:

```ts
export const sealCaptureJournalBeforeFinalization = async ({
  drainAppends,
  seal,
}: {
  drainAppends: () => Promise<void>;
  seal: () => Promise<void>;
}): Promise<'sealed' | 'recovery_required'> => {
  await drainAppends();
  try {
    await seal();
    return 'sealed';
  } catch {
    return 'recovery_required';
  }
};
```

Run the focused test again and expect PASS.

- [ ] **Step 4: Move the append drain and seal boundary ahead of transcription**

In `stopSession`, keep recorder shutdown and journal append production unchanged, then order the boundary as:

```ts
const journalSealOutcome = await sealCaptureJournalBeforeFinalization({
  drainAppends: async () => captureJournalWriteQueueRef.current,
  seal: async () => {
    await window.ipcRenderer.invoke('AUDIO_CAPTURE_JOURNAL_SEAL', {
      meetingId: stopSnapshot.meetingId,
      endedAtMs: stopSnapshot.recordingEndedAtMs,
    });
  },
});
```

Only after a successful seal may `pendingMicChunksRef` entries be enqueued and `processingQueueRef.current` awaited.

- [ ] **Step 5: Add the degraded early-return path**

Immediately after the seal attempt:

```ts
if (journalSealOutcome === 'recovery_required') {
  console.warn('[Pluto] Capture journal seal failed; preserving recovery state');
  warnCaptureDurability();
  const degradedMeeting = buildRecoverableSealFailureMeeting({
    snapshot: stopSnapshot,
    title: userTitle,
    userNotes,
    endReason,
  });
  await window.ipcRenderer.invoke('SAVE_MEETING', degradedMeeting);
  onSessionComplete?.(degradedMeeting.id);
  alert('Recording saved - processing needs recovery');
  return;
}
```

Do not interpolate `journalSealError` into UI, stored fields, or issue-visible logs. The outer `finally` remains responsible for releasing the single-flight state.

- [ ] **Step 6: Mark successful meeting saves finalized explicitly**

Add to the normal `meetingData` payload:

```ts
finalization_status: 'finalized',
finalization_error_category: null,
```

Add the same fields to the existing generic processing-error recovery save only when its journal seal succeeded, so it remains a finalized-journal meeting with transcript attention rather than `recovery_required`.

- [ ] **Step 7: Run focused and surrounding suites**

Run:

```bash
pnpm exec vitest run tests/unit/recordingFinalization.test.ts tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts
```

Expected: PASS with no normal finalization path reachable after a seal failure.

- [ ] **Step 8: Commit seal-first orchestration**

```bash
git add src/components/AudioManager.tsx src/utils/recordingFinalization.ts tests/unit/recordingFinalization.test.ts
git commit -m "feat: preserve meetings when journal sealing fails (#535)"
```

### Task 4: Surface recovery truth and block finalized-evidence consumers

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Test: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [ ] **Step 1: Write failing recovery-panel and gating tests**

Add `finalizationStatus` to `TranscriptIntegrityPanel` and test:

```tsx
render(
  <TranscriptIntegrityPanel
    status="needs_attention"
    finalizationStatus="recovery_required"
  />,
);

expect(screen.getByText('Recording saved')).toBeInTheDocument();
expect(
  screen.getByText('Processing needs recovery before this meeting is complete.'),
).toBeInTheDocument();
expect(screen.queryByRole('button', { name: /retry transcript/i })).toBeNull();
```

Change the intelligence predicate tests to call:

```ts
expect(canGenerateMeetingIntelligence('validated', 'recovery_required')).toBe(false);
expect(canGenerateMeetingIntelligence('validated', 'finalized')).toBe(true);
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `pnpm exec vitest run tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

Expected: FAIL because finalization status is not accepted or rendered.

- [ ] **Step 3: Render the content-free recovery panel**

Extend the panel props with `finalizationStatus?: Meeting['finalization_status']`. Return the recovery panel before transcript-validation rendering:

```tsx
if (finalizationStatus === 'recovery_required') {
  return (
    <section aria-live="polite" className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
      <strong className="text-sm text-pro-text">Recording saved</strong>
      <p className="mt-1 text-sm text-pro-text-muted">
        Processing needs recovery before this meeting is complete.
      </p>
    </section>
  );
}
```

Pass `selectedMeeting.finalization_status` at the existing call site.

- [ ] **Step 4: Gate intelligence on both lifecycles**

Change the predicate to:

```ts
export const canGenerateMeetingIntelligence = (
  transcriptStatus: Meeting['transcript_status'],
  finalizationStatus: Meeting['finalization_status'],
) =>
  finalizationStatus !== 'recovery_required' &&
  (transcriptStatus == null || transcriptStatus === 'validated');
```

Update both Meeting View call sites to pass `selectedMeeting.finalization_status`.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the truthful recovery surface**

```bash
git add src/components/features/MeetingView.tsx tests/unit/MeetingViewTranscriptIntegrity.test.tsx
git commit -m "feat: surface meetings awaiting recovery (#535)"
```

### Task 5: Record the decision and verify the complete slice

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-07-22-535-recoverable-seal-failure.md`

- [ ] **Step 1: Record the durable decision**

Add a concise entry stating: journal seal gates normal finalization; failure preserves a visible `recovery_required` meeting and unsealed recovery source; finalized-evidence consumers must defer; errors remain content-free.

- [ ] **Step 2: Add the changelog fragment**

Use the repository-required fields:

```markdown
Issue: #535
PR: pending
Changed: Recording stop now preserves a visible recovery-required meeting when capture-journal sealing fails.
Why: A meeting must not disappear, but unsealed evidence must not look normally finalized.
Replaced: Warning-and-continue finalization after a journal seal failure.
Notes: Automatic recovery and retry controls remain follow-up work.
```

- [ ] **Step 3: Run focused verification**

```bash
pnpm exec vitest run tests/unit/meetingInsertSql.test.ts tests/unit/recordingFinalization.test.ts tests/unit/captureJournal.test.ts tests/unit/captureJournalRecovery.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx
```

Expected: all focused files pass.

- [ ] **Step 4: Run repository verification**

```bash
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
pnpm run audit:high
git diff --check
```

Expected: all commands pass. Any unrelated environmental failure is recorded precisely without weakening a gate.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/decisions.md docs/changelog/entries/2026-07-22-535-recoverable-seal-failure.md
git commit -m "docs: record recoverable seal failure behavior (#535)"
```

- [ ] **Step 6: Push and update the PR and issue**

Push the implementation branch, update the PR with exact verification results and changed files, replace `PR: pending` in the changelog fragment with the actual PR number, and comment on #535 with the delivered behavior and remaining automatic-recovery follow-up.
