# Durable Meeting Notes Attempts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent automatic meeting-note generation from repeating expensive failed work across app restarts, and make organic latency reports distinguish meetings, attempts, and stable failure causes.

**Architecture:** Keep `meeting_analysis_runs` as the durable single-run authority rather than adding a second lease system. Persist an automatic-attempt counter on the current input revision, enforce the cap in both renderer eligibility and the main-process coordinator, and persist terminal error codes in run history. Extract organic report construction into the existing latency benchmark library so it can be tested without opening private data.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3, Vitest, SQLite migrations.

---

### Task 1: Persist automatic attempt state

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Test: `tests/unit/dbMeetingAnalysisRuns.test.ts`
- Test: `tests/unit/meetingAnalysisRuns.test.ts`

- [x] **Step 1: Write failing database tests**

Add tests proving that `beginMeetingAnalysisRun` receives `reason`, increments `automatic_attempt_count` only when an automatic run repeats the same input revision, resets it to one for a changed automatic revision, and does not consume another automatic attempt for a manual run.

```ts
beginMeetingAnalysisRun({ ...identity, reason: 'automatic' });
beginMeetingAnalysisRun({ ...nextRun, reason: 'automatic' });
expect(getMeetingAnalysisRun(meetingId)?.automatic_attempt_count).toBe(2);
```

- [x] **Step 2: Run the focused database test and verify RED**

Run: `pnpm vitest run tests/unit/dbMeetingAnalysisRuns.test.ts`

Expected: FAIL because `reason` and `automatic_attempt_count` do not exist.

- [x] **Step 3: Add the migration and atomic counter update**

Add `automatic_attempt_count INTEGER NOT NULL DEFAULT 0` to new schemas and an idempotent migration. Extend `MeetingAnalysisRun`, coordinator DB contracts, and `beginMeetingAnalysisRun` so the conflict update uses the prior row and incoming reason atomically:

```sql
automatic_attempt_count = CASE
  WHEN ? = 'automatic' AND meeting_analysis_runs.input_revision = excluded.input_revision
    THEN meeting_analysis_runs.automatic_attempt_count + 1
  WHEN ? = 'automatic' THEN 1
  ELSE meeting_analysis_runs.automatic_attempt_count
END
```

- [x] **Step 4: Add coordinator RED tests for the durable cap**

Add tests proving an automatic request with the same fingerprint and two prior failed attempts rejects with `meeting_notes_automatic_attempts_exhausted` before provider generation, while manual requests and changed fingerprints remain eligible.

- [x] **Step 5: Run the coordinator test and verify RED**

Run: `pnpm vitest run tests/unit/meetingAnalysisRuns.test.ts`

Expected: FAIL because the coordinator does not inspect the persisted counter.

- [x] **Step 6: Enforce the cap in the main-process coordinator**

After computing the generation fingerprint, reject only automatic requests whose current failed run has the same input revision and `automatic_attempt_count >= 2`. Pass `reason` to `beginMeetingAnalysisRun`.

- [x] **Step 7: Run focused tests and verify GREEN**

Run: `pnpm vitest run tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts`

Expected: PASS.

### Task 2: Avoid restart-driven renderer requests after exhaustion

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `src/services/retryMeetingTranscriptValidation.ts`
- Test: `tests/unit/postMeetingProcessingCoordinator.test.ts`
- Test: `tests/unit/dbMeetingAnalysisRuns.test.ts`

- [x] **Step 1: Write failing eligibility tests**

Add a meeting fixture whose `analysis_run_json` contains:

```json
{
  "notes_status": "failed",
  "automatic_attempt_count": 2,
  "automatic_attempts_exhausted": true
}
```

Assert that `shouldAutoProcessMeetingAnalysis` and `selectNextMeetingForProcessing` reject it, while a failed one-attempt fixture remains eligible.

- [x] **Step 2: Run the eligibility tests and verify RED**

Run: `pnpm vitest run tests/unit/postMeetingProcessingCoordinator.test.ts`

Expected: FAIL because analysis-run exhaustion is ignored.

- [x] **Step 3: Add the current-revision exhaustion read model**

Add a database helper that compares the current meeting source, eligibility, and user-notes revisions with the persisted run and returns true only when the matching failed run exhausted two automatic attempts. Serialize that boolean with `analysis_run_json` in `withNotesRun`.

- [x] **Step 4: Apply renderer eligibility gating**

Parse `analysis_run_json` defensively and stop automatic selection only when `automatic_attempts_exhausted === true`. Preserve manual retry and changed-source behavior.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run tests/unit/postMeetingProcessingCoordinator.test.ts tests/unit/dbMeetingAnalysisRuns.test.ts`

Expected: PASS.

### Task 3: Persist stable failure codes in run history

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Test: `tests/unit/dbMeetingAnalysisRuns.test.ts`
- Test: `tests/unit/meetingAnalysisRuns.test.ts`

- [x] **Step 1: Write failing history tests**

Assert that a failed coordinator run writes its stable `errorCode` into `meeting_analysis_run_history`, and that published/cancelled runs store null unless a terminal code is supplied.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts`

Expected: FAIL because history has no `error_code` column or record field.

- [x] **Step 3: Add the schema and coordinator wiring**

Add the nullable history column and migration. Extend `MeetingAnalysisRunMetricRecord`, the upsert/list functions, and `finalizeMetric` so catch paths pass `errorCode(error)` without retaining raw exception messages.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts`

Expected: PASS.

### Task 4: Make organic latency reporting representative

**Files:**
- Modify: `scripts/lib/meeting_notes_latency_benchmark.ts`
- Modify: `scripts/report_meeting_notes_latency.ts`
- Test: `tests/unit/meetingNotesLatencyManifest.test.ts`

- [x] **Step 1: Write failing aggregation tests**

Add content-free fixtures with repeated failed attempts for one opaque meeting key and successful attempts for three other keys. Assert the report includes `attemptCount`, `distinctMeetingCount`, `maxAttemptsPerMeeting`, `failureCodes`, `truncatedStageCount`, and latency aggregates only for published runs.

- [x] **Step 2: Run the aggregation test and verify RED**

Run: `pnpm vitest run tests/unit/meetingNotesLatencyManifest.test.ts`

Expected: FAIL because representative-history aggregation does not exist.

- [x] **Step 3: Implement a pure organic-history report builder**

Accept opaque meeting keys, status, stable failure code, duration bucket, and parsed metrics. Emit counts and aggregates only. Never emit meeting keys, run IDs, content sizes, paths, prompts, or responses.

- [x] **Step 4: Use the pure builder in the database reporter**

Select `meeting_id` and `error_code` internally, map them to opaque in-memory grouping keys, and print only the content-free aggregate report.

- [x] **Step 5: Run focused tests and the read-only organic report**

Run: `pnpm vitest run tests/unit/meetingNotesLatencyManifest.test.ts`

Run: `PLUTO_DB_PATH="/Users/metagrover/Library/Application Support/pluto/pluto.db" pnpm run report:meeting-notes-latency`

Expected: tests pass; the report shows 24 attempts concentrated on one meeting and stable failure/truncation counts without identifiers.

### Task 5: Document and verify the shipped boundary

**Files:**
- Modify: `docs/meeting-notes-latency-benchmark.md`
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-08-31-698-bounded-meeting-notes-latency.md`

- [x] **Step 1: Document the durable policy and report semantics**

Record that automatic attempts are capped per exact generation fingerprint across restarts, manual retry is explicit, raw errors remain excluded, and organic reports distinguish attempts from distinct meetings.

- [x] **Step 2: Run the complete focused verification**

Run: `pnpm vitest run tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts tests/unit/postMeetingProcessingCoordinator.test.ts tests/unit/processValidatedMeetingDownstream.test.ts tests/unit/meetingNotesLatencyManifest.test.ts`

Expected: PASS.

- [x] **Step 3: Run repository verification**

Run: `pnpm vitest run`

Run: `pnpm exec tsc --noEmit`

Run: `pnpm run lint`

Run: `pnpm vite build`

Run: `pnpm run changelog:check && pnpm run audit:high && git diff --check`

Expected: all commands exit zero; only the known Biome broken-store-symlink warnings may remain.

- [x] **Step 4: Commit the focused change**

```bash
git add electron/db.ts electron/main.ts electron/meetingAnalysisRuns.ts src/services/retryMeetingTranscriptValidation.ts scripts/lib/meeting_notes_latency_benchmark.ts scripts/report_meeting_notes_latency.ts tests/unit docs/meeting-notes-latency-benchmark.md docs/decisions.md docs/changelog/entries/2026-08-31-698-bounded-meeting-notes-latency.md docs/superpowers/plans/2026-09-01-698-durable-notes-attempts.md
git commit -m "fix(notes): bound automatic attempts across restarts"
```
