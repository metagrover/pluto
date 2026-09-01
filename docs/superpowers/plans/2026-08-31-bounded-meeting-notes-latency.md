# Bounded Meeting-Notes Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every non-UI behavior change and superpowers:verification-before-completion before claiming any gate passed.

**Goal:** Cut median time-to-trusted-notes for the fixed 30-minute local benchmark by at least 50%, make burst scheduling predictable, and recover bounded truncations without weakening source-grounding or publication safety.

**Architecture:** Add privacy-safe lifecycle metrics and a local benchmark first; then decouple source-leaf capacity from concrete merge capacity and add node-local truncation recovery; finally admit one primary meeting at a time with explicit work classes and expose persisted queue position through the existing meeting update path.

**Tech Stack:** TypeScript, Electron main-process IPC, React, better-sqlite3, Ollama/provider adapters, Vitest, Biome, existing meeting-notes quality fixtures, and local read-only benchmark manifests.

---

## 0. Execution contract

**Issue:** [#698](https://github.com/metagrover/pluto/issues/698)

**Approved design:** [Bounded meeting-notes latency](../specs/2026-08-31-bounded-meeting-notes-latency-design.md)

**Related scope boundary:** #695 owns thermal admission and cooldown policy.

The current checkout contains unrelated user work. Do not implement on it. When execution begins:

```bash
cd /Users/metagrover/Desktop/pluto
git status --short --branch
git worktree add /Users/metagrover/Desktop/pluto/.worktrees/698-bounded-notes-latency -b codex/698-bounded-notes-latency master
cd /Users/metagrover/Desktop/pluto/.worktrees/698-bounded-notes-latency
pnpm install
```

Expected: the new worktree is clean and the original checkout's modified/untracked files are untouched. Before implementation, rebase the worktree on the then-current `master` only if it can be done without changing the original checkout.

Do not run new private meetings or regenerate production data as part of ordinary unit-test work. Real-model benchmarks require an explicit private manifest and run against read-only source data. They publish nothing.

## 1. Establish the privacy-safe metrics contract

**Files:**

- Create: `electron/llm/meetingNotesRunMetrics.ts`
- Create: `tests/unit/meetingNotesRunMetrics.test.ts`
- Modify: `electron/llm/meetingNotesTypes.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `tests/unit/meetingNotesTransport.test.ts`

### Step 1: Write failing collector/validator tests

Cover:

- queue wait and model time are recorded separately;
- a completed Ollama packet records token counts through `readNotesMetrics`;
- hosted-provider completion permits null token counts;
- cooperative Ask Pluto preemption is recorded as `preempted`, then a later attempt completes the same logical work unit;
- truncation, cancellation, and failure terminate a stage exactly once;
- more than 256 stage records is rejected or capped deterministically;
- arbitrary strings such as `prompt`, `transcript`, `notes`, `title`, `speaker`, `audioPath`, and raw provider packets are absent from serialized output;
- negative, infinite, and non-integer counts are rejected.

The public callback should be small and stage-oriented:

```ts
export type NotesStageObserver = {
  queued(event: { task: NotesTask; sequence: number; at: number }): void;
  started(event: { sequence: number; at: number }): void;
  finished(event: NotesStageTerminalEvent): void;
};
```

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesRunMetrics.test.ts tests/unit/meetingNotesTransport.test.ts
```

Expected: new assertions fail because no observer/collector is wired.

### Step 2: Implement the typed collector

Implement `createMeetingNotesRunMetrics`, `parseMeetingNotesRunMetric`, and `serializeMeetingNotesRunMetric`. Use an allow-list serializer rather than spreading unknown provider objects. Use `performance.now()`-compatible numeric timestamps internally and store rounded non-negative milliseconds.

Add optional callbacks to `GenerateMeetingNotesInput` and `NotesRequest` without changing the prompt, response contract, source spans, or publication document.

### Step 3: Wire provider stage lifecycle

In `UnifiedLLMProvider.generateStructuredAnalysis`, create one sequence per `NotesRequest`. In `generateText`:

- emit queued immediately before the Ollama gate call;
- emit started inside the admitted gate callback and immediately before hosted requests;
- pass only parsed token/duration numbers from a terminal Ollama packet;
- classify `notes_output_truncated` as `truncated`;
- classify aborts as `cancelled`;
- finish in one code path so thrown parse/transport errors cannot double-count.

Do not remove existing logs in this task; the persisted collector becomes the source of truth and log cleanup can occur after parity is verified.

### Step 4: Make the focused tests pass

Run the same command. Expected: all metrics and transport tests pass.

### Step 5: Commit

```bash
git add electron/llm/meetingNotesRunMetrics.ts electron/llm/meetingNotesTypes.ts electron/llm/unifiedProvider.ts tests/unit/meetingNotesRunMetrics.test.ts tests/unit/meetingNotesTransport.test.ts
git commit -m "feat(notes): capture privacy-safe stage timings (#698)"
```

## 2. Persist bounded run history and queue position

**Files:**

- Modify: `electron/db.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/dbMeetingAnalysisRuns.test.ts`
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`

### Step 1: Write failing database tests

Add tests that initialize a legacy-shaped database and prove:

- `meeting_analysis_runs.queue_position` is added idempotently;
- `meeting_analysis_run_history` and its completed-time index exist;
- queued starts serialize as `notes_status='running'`, `stage='queued'`, position 1+;
- admission clears `queue_position` and changes stage without replacing the run identity;
- publish/fail/cancel writes one valid terminal history row;
- history retention keeps the newest 100 terminal rows;
- deleting a meeting removes its history explicitly;
- startup recovery marks both queued and generating rows interrupted and clears queue position;
- prior `analysis_json`, `enhanced_notes`, and `user_edits_json` remain byte-identical after a failed run.

Run:

```bash
pnpm exec vitest run tests/unit/dbMeetingAnalysisRuns.test.ts
```

Expected: schema and lifecycle assertions fail.

### Step 2: Add schema and narrow DB APIs

Extend `MeetingAnalysisRun` with `queue_position: number | null`. Add:

```ts
beginMeetingAnalysisRun(input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  stage: 'queued' | 'notes_writer';
  queuePosition?: number | null;
})
updateMeetingAnalysisQueuePosition(input: { meetingId; runId; queuePosition: number | null }): boolean
upsertMeetingAnalysisRunMetric(input: { runId; meetingId; reason; status; metrics }): void
listMeetingAnalysisRunMetrics(input: { limit: number }): MeetingAnalysisRunMetric[]
```

Use a transaction for terminal status plus history finalization. Retention executes only after a terminal write. Validate `metrics_json` before insert and after read.

### Step 3: Connect the coordinator lifecycle

Create the run metric before queue/admission. Update it on every stage callback and terminal path. Ensure `onUpdated` fires after queue-position changes so `App.tsx` refreshes the meeting via the existing `MEETING_NOTES_UPDATED` listener.

Do not add a renderer IPC that returns raw history. Organic averages remain a local reporting/debug capability in this issue.

### Step 4: Run focused tests

```bash
pnpm exec vitest run tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts
```

Expected: history, retention, recovery, cancellation, and prior-note tests pass.

### Step 5: Commit

```bash
git add electron/db.ts electron/meetingAnalysisRuns.ts electron/main.ts tests/unit/dbMeetingAnalysisRuns.test.ts tests/unit/meetingAnalysisRuns.test.ts
git commit -m "feat(notes): persist bounded run metrics and queue state (#698)"
```

## 3. Add the read-only latency benchmark and average report

**Files:**

- Create: `scripts/validate_private_meeting_notes_latency_manifest.ts`
- Create: `scripts/run_meeting_notes_latency_benchmark.ts`
- Create: `scripts/report_meeting_notes_latency.ts`
- Create: `tests/unit/meetingNotesLatencyManifest.test.ts`
- Create: `tests/manual/meetingNotesLatencyBenchmark.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docs/benchmarks.md` if it exists; otherwise create `docs/meeting-notes-latency-benchmark.md`

### Step 1: Define and test the private manifest

Use this local-only shape:

```json
{
  "schemaVersion": 1,
  "databasePath": "/absolute/path/to/pluto.db",
  "cases": [
    { "caseKey": "m15-a", "meetingId": "local-id", "durationBucket": "15m" },
    { "caseKey": "m30-a", "meetingId": "local-id", "durationBucket": "30m" },
    { "caseKey": "m45-a", "meetingId": "local-id", "durationBucket": "45m" }
  ]
}
```

Validation requires an absolute DB path, unique opaque `caseKey`, unique meeting ID, and an allowed bucket. Error output names only the case key. Add ignore patterns for `.private/meeting-notes-latency*.json` and `.artifacts/meeting-notes-latency/`.

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesLatencyManifest.test.ts
```

Expected: fail before implementation, then pass with validation.

### Step 2: Implement a non-publishing runner

Open SQLite read-only, call `PRAGMA table_info(meetings)` before selecting current columns, load only the selected transcript/source metadata in memory, and invoke the production provider/pipeline without `publishMeetingNotesIfCurrent` or any DB write API.

The report may contain:

- case key and duration bucket;
- provider/model/prompt version;
- source character/segment counts;
- planned leaves, generated nodes, model calls;
- queue, model, total milliseconds;
- repair/repartition counts;
- terminal status and stable error code;
- hashes of configuration and fixture order.

The report must not contain meeting ID, DB path, title, transcript, notes, prompt, participant, source text/span, audio path, or raw model output. Add a recursive forbidden-key and sentinel-value test before writing a report.

### Step 3: Implement modes and scripts

Add:

```json
{
  "benchmark:meeting-notes-latency:validate": "node --experimental-strip-types scripts/validate_private_meeting_notes_latency_manifest.ts",
  "benchmark:meeting-notes-latency": "RUN_MEETING_NOTES_LATENCY_BENCHMARK=1 vitest run --config vitest.manual.config.ts tests/manual/meetingNotesLatencyBenchmark.test.ts",
  "report:meeting-notes-latency": "node --experimental-strip-types scripts/report_meeting_notes_latency.ts"
}
```

The benchmark accepts `isolated`, `repeat-30`, and `burst` modes. `repeat-30` requires three completed runs. The organic report opens the live DB read-only, joins source duration/counts only in memory, groups into `<20m`, `20–40m`, and `>40m`, and prints “not enough evidence” for fewer than three samples.

### Step 4: Add fake-provider manual-contract coverage

The manual test should first run with a deterministic fake provider to prove ordering, report redaction, aggregation, and failure output without spending model time. Real-provider execution remains opt-in through the environment variable and private manifest.

### Step 5: Verify no source mutation

Before and after a real benchmark, capture:

```bash
sqlite3 -readonly "$PLUTO_DB_PATH" "PRAGMA integrity_check; SELECT COUNT(*), MAX(updated_at) FROM meetings;"
```

Expected: `ok`; count and max timestamp unchanged. Do not put the DB path or row output in a committed artifact.

### Step 6: Commit

```bash
git add .gitignore package.json scripts/validate_private_meeting_notes_latency_manifest.ts scripts/run_meeting_notes_latency_benchmark.ts scripts/report_meeting_notes_latency.ts tests/unit/meetingNotesLatencyManifest.test.ts tests/manual/meetingNotesLatencyBenchmark.test.ts docs
git commit -m "test(notes): add private latency benchmark and local report (#698)"
```

## 4. Capture the baseline before changing planning

**Files:**

- Local only: `.private/meeting-notes-latency.json`
- Local only: `.artifacts/meeting-notes-latency/baseline.json`
- Modify issue #698 with content-free aggregate results only

### Step 1: Isolate the runtime

Close stale Pluto runtimes that are not the benchmark owner, verify Ollama has no competing request, and record model/context/seed/commit. Do not change the configured model. Warm the model with an untimed contract-valid fixture.

### Step 2: Run baseline modes

```bash
pnpm run benchmark:meeting-notes-latency:validate -- --manifest .private/meeting-notes-latency.json
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode isolated --output .artifacts/meeting-notes-latency/baseline-isolated.json
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode repeat-30 --output .artifacts/meeting-notes-latency/baseline-repeat-30.json
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode burst --output .artifacts/meeting-notes-latency/baseline-burst.json
```

Expected: reports contain only allow-listed metrics. If any run fails, preserve the failure category and elapsed time; do not silently retry it into the average.

### Step 3: Record the baseline gate

Post only aggregate data to #698: commit, model, context, sample counts, median/mean/p90, call counts, queue/model split, publish/failure counts. Never post IDs or content.

No code commit is required for local artifacts.

## 5. Decouple leaf capacity from concrete merge capacity

**Files:**

- Modify: `electron/llm/meetingNotesPipeline.ts`
- Modify: `electron/llm/meetingNotesHierarchy.ts`
- Modify: `electron/llm/meetingNotesTypes.ts`
- Modify: `tests/unit/meetingNotesHierarchy.test.ts`
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `tests/unit/meetingNotesCancellationContext.test.ts`

### Step 1: Write failing planner tests

Add synthetic sources proving:

- leaf fit checks writer plus audit capacity only;
- no hypothetical merge prompt is built during leaf partitioning;
- every primary source segment appears in exactly one leaf;
- overlap remains evidence-only and does not duplicate primary ownership;
- actual merge pair selection still checks merge writer and audit capacity;
- concrete oversized drafts are split only between claims;
- source spans, owners, due dates, conditions, IDs, and dispositions survive repacking;
- cancellation during planning or between leaves stops before the next request.

Include a regression fixture whose old planner yields eight or more leaves and whose new planner yields four or fewer under the same 16,384-token context. The fixture must be synthetic and contain no private text.

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesCancellationContext.test.ts
```

Expected: new leaf-count and no-hypothetical-merge assertions fail.

### Step 2: Extract a leaf-only capacity predicate

In `meetingNotesPipeline.ts`, replace the merge reservation in the `planNotesLeaves` callback with:

```ts
const fitsLeaf = (spans: SourceSpan[]) => {
  const sourceText = serializeSource(input, spans);
  const writerPrompt = buildNotesWriterPrompt({
    sourceText,
    userNotes: input.context.userNotes,
    knownTerms,
    template: input.context.template,
  });
  const auditBase = reviewPrompt(input, {
    sourceText,
    draft: {},
    userNotes: input.context.userNotes,
    knownTerms,
  });
  return fits(input, writerPrompt, WRITER_OUTPUT_TOKENS) &&
    estimateNotesTokens(auditBase) +
      WRITER_OUTPUT_TOKENS +
      reviewOutputTokens(input) +
      SAFETY_TOKENS <= planningTokens;
};
```

Keep concrete pair selection in the merge loop using actual drafts. Emit planned leaf count once and actual generated-node count at completion.

### Step 3: Run focused and guardrail tests

```bash
pnpm exec vitest run tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesAuditRepair.test.ts tests/unit/meetingNotesGuardrails.test.ts tests/unit/meetingNotesCancellationContext.test.ts
```

Expected: all pass; request contracts remain writer/audit for each generated node.

### Step 4: Commit

```bash
git add electron/llm/meetingNotesPipeline.ts electron/llm/meetingNotesHierarchy.ts electron/llm/meetingNotesTypes.ts tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesCancellationContext.test.ts
git commit -m "perf(notes): plan leaves independently from merges (#698)"
```

## 6. Add bounded node-local truncation recovery

**Files:**

- Modify: `electron/llm/meetingNotesBudget.ts`
- Modify: `electron/llm/meetingNotesHierarchy.ts`
- Modify: `electron/llm/meetingNotesPipeline.ts`
- Modify: `electron/llm/meetingNotesStageCache.ts`
- Create: `tests/unit/meetingNotesTruncationRecovery.test.ts`
- Modify: `tests/unit/meetingNotesStageCache.test.ts`
- Modify: `tests/unit/meetingNotesCancellationContext.test.ts`

### Step 1: Write stage-specific failing tests

Use a scripted fake generator to force truncation at:

- first leaf writer;
- middle leaf audit after earlier siblings completed;
- merge writer;
- final merge audit;
- a minimal unsplittable leaf;
- a run cancelled immediately before retry;
- a run cancelled while the recovery request is queued.

Assert:

- one compact retry occurs for the affected stage;
- repeated leaf truncation bisects only that leaf;
- completed siblings are not regenerated;
- repeated merge truncation repacks only the affected node;
- inherited commitments and exact source spans remain intact;
- node/depth limits terminate as `notes_repartition_exhausted`;
- cancellation stays `notes_cancelled` and never increments repartition after abort;
- prior published notes remain untouched at coordinator level.

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesTruncationRecovery.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts
```

Expected: fail because `notes_output_truncated` currently escapes the pipeline.

### Step 2: Add deterministic source-window bisection

Implement `bisectNotesSourceWindow(source, window)` in `meetingNotesBudget.ts`. Prefer the nearest source-segment boundary to half of primary characters. If one segment is larger than the window, split at whitespace without breaking a UTF-16 surrogate pair. Both children must be non-empty, disjoint in primary spans, and together equal the parent's primary coverage.

### Step 3: Add the work-unit recovery wrapper

Wrap `writeDraft` and `auditDraft` at the hierarchy work-unit boundary, not inside transport. Build the compact retry prompt from the same original prompt plus a fixed instruction; never include a partial provider response. Catch only `MeetingNotesError('notes_output_truncated')`.

Maintain a recovery ledger keyed by stage plus source/draft hash. A key gets one compact retry and one repartition. Preserve the existing parse-repair count separately from `repartitionCount`.

### Step 4: Re-enter only affected work

Refactor leaf processing into `processLeaf(leaf, depth)` returning one or more audited nodes. Refactor concrete merging into `mergeFrontier(nodes)`. When recovery splits/repackages, append only replacement nodes and retain all completed siblings in memory and cache.

Do not catch `notes_audit_invalid`, `notes_writer_invalid`, `notes_merge_dropped_commitment`, `notes_context_exhausted`, guardrail failures, or aborts in this path.

### Step 5: Expand the private in-memory cache safely

Change `NotesStageCache` from four to 64 entries, preserve the 15-minute TTL and structured cloning, and add eviction/expiry tests. Do not persist drafts or add them to metrics.

### Step 6: Run focused tests

```bash
pnpm exec vitest run tests/unit/meetingNotesTruncationRecovery.test.ts tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts
```

Expected: every injected recoverable truncation completes; bounded/invalid/cancelled cases fail with their exact expected category.

### Step 7: Commit

```bash
git add electron/llm/meetingNotesBudget.ts electron/llm/meetingNotesHierarchy.ts electron/llm/meetingNotesPipeline.ts electron/llm/meetingNotesStageCache.ts tests/unit/meetingNotesTruncationRecovery.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts
git commit -m "fix(notes): recover truncated hierarchy work locally (#698)"
```

## 7. Implement one-active-primary scheduling

**Files:**

- Create: `electron/meetingNotesScheduler.ts`
- Create: `tests/unit/meetingNotesScheduler.test.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Modify: `electron/db.ts`
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`
- Modify: `tests/unit/dbMeetingAnalysisRuns.test.ts`

### Step 1: Write failing scheduler tests

Use deferred promises and a fake clock to prove:

- exactly one primary meeting is admitted;
- manual requests are FIFO among manuals;
- automatic requests are FIFO among automatics;
- queued manual requests move ahead of queued automatic requests;
- a manual does not abort an already active automatic run;
- cancelling a queued subscriber removes it without starting generation;
- same-meeting same-fingerprint subscribers coalesce to one queue entry;
- superseding a queued meeting invalidates its old entry;
- queue positions update after enqueue, cancel, admit, and finish;
- an admitted job revalidates source/publication revisions before its first model call;
- one failed job cannot poison the queue.

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesScheduler.test.ts tests/unit/meetingAnalysisRuns.test.ts
```

Expected: scheduler tests fail before implementation.

### Step 2: Implement the scheduler as a small independent module

Expose:

```ts
type MeetingNotesScheduleClass = 'manual' | 'automatic';

type MeetingNotesScheduler = {
  enqueue<T>(job: ScheduledMeetingNotesJob<T>): Promise<T>;
  cancel(key: string, reason: unknown): boolean;
  snapshot(): Array<{ key: string; state: 'active' | 'queued'; position: number | null }>;
};
```

Selection is manual-first then sequence-first. The scheduler owns no DB, provider, or meeting content. It invokes `onSnapshot` after every state transition.

### Step 3: Place admission around the primary run

In `meetingAnalysisRuns.ts`, keep source eligibility, fingerprinting, and same-meeting coalescing, then enqueue the expensive generation/publication body. Create the current run row as queued so UI state exists immediately. On admission, re-read the meeting and revisions; cancel as superseded if they differ.

Ensure secondary retries (`reason='secondary'`) do not enter the primary queue, but their provider work class remains below primary notes.

### Step 4: Persist queue snapshots

Map scheduler snapshots to `queue_position`. Active primary has null queue position and its current notes stage. Queued rows have stage `queued`. Use one DB transaction per snapshot update and notify only meeting IDs whose position/state changed.

### Step 5: Run coordinator and DB tests

```bash
pnpm exec vitest run tests/unit/meetingNotesScheduler.test.ts tests/unit/meetingAnalysisRuns.test.ts tests/unit/dbMeetingAnalysisRuns.test.ts
```

Expected: FIFO, cancellation, coalescing, revalidation, and preservation tests pass.

### Step 6: Commit

```bash
git add electron/meetingNotesScheduler.ts electron/meetingAnalysisRuns.ts electron/db.ts tests/unit/meetingNotesScheduler.test.ts tests/unit/meetingAnalysisRuns.test.ts tests/unit/dbMeetingAnalysisRuns.test.ts
git commit -m "feat(notes): schedule primary meetings predictably (#698)"
```

## 8. Make provider work classes explicit

**Files:**

- Modify: `electron/llm/provider.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/serializedTaskGate.test.ts`
- Modify: `tests/unit/meetingNotesProviderRouting.test.ts`
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`

### Step 1: Write failing priority/preemption tests

Cover the exact order:

1. Ask Pluto (30)
2. manual notes (20)
3. automatic notes and existing project review (15)
4. meeting secondary (5)
5. knowledge/commitment background (0)

Also prove:

- FIFO remains within a class;
- Ask Pluto can preempt resumable notes at a model-call boundary;
- manual notes do not erase a preempted run's cache;
- primary notes run before queued secondary extraction;
- secondary resumes after the primary queue drains;
- cancellation reason is preserved through `AbortSignal.any`.

### Step 2: Add `LLMWorkClass`

Define one exported mapping in `unifiedProvider.ts` or a focused `electron/llm/llmWorkClass.ts`; do not duplicate nested task ternaries. Pass `workClass` through `generateStructuredAnalysis`, `extractValueSignals`, and `extractEntities` options. Notes requests inherit manual/automatic from the coordinator; secondary methods receive `meeting_secondary` from `main.ts`.

Keep task names for prompt/model behavior. Work class controls scheduling only.

### Step 3: Run focused tests

```bash
pnpm exec vitest run tests/unit/serializedTaskGate.test.ts tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingAnalysisRuns.test.ts
```

Expected: exact order and preemption behavior pass.

### Step 4: Commit

```bash
git add electron/llm/provider.ts electron/llm/unifiedProvider.ts electron/meetingAnalysisRuns.ts electron/main.ts tests/unit/serializedTaskGate.test.ts tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingAnalysisRuns.test.ts
git commit -m "refactor(llm): make notes work priorities explicit (#698)"
```

## 9. Present queued versus generating state

**Files:**

- Modify: `src/components/features/downstreamProcessingPresentation.ts`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/types.ts`
- Modify: `src/index.css`
- Modify: `tests/unit/downstreamProcessingPresentation.test.ts`
- Modify: `tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

### Step 1: Write failing presentation tests

Cover:

- no-notes manual queue position 1 renders “Notes are next” in the existing reading column;
- position 3 renders “Position 3 in the local notes queue”;
- generating state replaces queued copy when position becomes null and stage becomes a notes stage;
- existing notes remain visible throughout queue/generation;
- a failed regeneration still shows previous notes and the existing retry notice;
- malformed/negative queue position falls back to the safe loading state;
- screen-reader status uses `role='status'` and does not repeatedly announce unchanged polling updates.

Run:

```bash
pnpm exec vitest run tests/unit/downstreamProcessingPresentation.test.ts tests/unit/MeetingViewProgressiveReveal.dom.test.tsx
```

Expected: queued-state assertions fail.

### Step 2: Extend the pure presentation model

Parse `stage` and `queue_position` from `analysis_run_json`. Add the `queued` state only for `stage='queued'` and a positive safe-integer position. Preserve current precedence: transcript failure, existing valid analysis, run failure/cancellation, downstream processing, legacy enhanced notes, then loading fallback.

### Step 3: Render restrained status in `MeetingView`

Reuse the existing `MEETING_NOTES_UPDATED` refresh path in `App.tsx`; do not add a polling loop for meetings that already have notes. Show the compact queue status adjacent to the regeneration affordance when notes exist and inside the current analysis skeleton when they do not.

Do not display a progress percentage or ETA. Add only the CSS needed for hierarchy/alignment and preserve the current 760px reading measure.

### Step 4: Run focused DOM tests

```bash
pnpm exec vitest run tests/unit/downstreamProcessingPresentation.test.ts tests/unit/MeetingViewProgressiveReveal.dom.test.tsx
```

Expected: all queued/generating/preserved-note cases pass.

### Step 5: Rendered-app verification

With a fake/deferred provider or controlled development fixture, inspect at desktop width and 430px/half-width:

- queued position 1 and 3;
- transition to generating;
- old notes visible during regeneration;
- failure with old notes preserved;
- dark and light themes;
- keyboard focus remains on the initiating context where practical.

Capture screenshots locally for review; do not commit private meeting content.

### Step 6: Commit

```bash
git add src/components/features/downstreamProcessingPresentation.ts src/components/features/MeetingView.tsx src/types.ts src/index.css tests/unit/downstreamProcessingPresentation.test.ts tests/unit/MeetingViewProgressiveReveal.dom.test.tsx
git commit -m "feat(notes): show truthful local queue progress (#698)"
```

## 10. Run candidate benchmarks and evaluate the gate

**Files:**

- Local only: `.artifacts/meeting-notes-latency/candidate-*.json`
- Modify: `docs/decisions.md`
- Modify: issue #698 with aggregate results

### Step 1: Repeat the exact baseline environment

Use the same manifest, fixture order, model, context, seed, warm-up, and competing-process policy. Record the candidate commit.

### Step 2: Run isolated, repeated-30, and burst modes

Use the commands from Task 4 with candidate output names. Do not retry failed cases outside the report.

### Step 3: Compare automatically

The comparison command must fail non-zero unless:

- candidate 30-minute median is at least 50% lower;
- all candidate cases publish;
- no run exceeds depth/node bounds;
- burst first completion is ≤1.25× candidate isolated 30-minute median;
- queue order matches policy;
- redaction validator passes both baseline and candidate reports.

Print model-active reduction separately from queue reduction. If total latency improves only because queue measurement changed, the gate fails.

### Step 4: Decide without weakening quality

If the speed gate fails, inspect leaf/call counts and model-active time:

- high leaf count: fix capacity estimates or prompt overhead accounting;
- low leaf count but high call time: investigate provider/model decode separately;
- repeated truncation: inspect only counts/error categories, then improve bounded partitioning;
- burst-only regression: fix scheduler/work-class behavior.

Do not lower output tokens or remove audits in response to a failed gate. Audit-count reduction requires a separate measured experiment and explicit issue update.

### Step 5: Record the decision

Add a concise entry to `docs/decisions.md` with baseline/candidate aggregate metrics, accepted flags/defaults, quality gate result, and #695 boundary. Post the same content-free summary to #698.

Commit:

```bash
git add docs/decisions.md
git commit -m "docs(notes): record latency promotion decision (#698)"
```

## 11. Run the full trust and lifecycle acceptance matrix

**Files:**

- Modify only if a real regression is found: affected source/tests
- Add: `docs/changelog/entries/2026-08-31-698-bounded-meeting-notes-latency.md`

### Step 1: Focused notes and lifecycle suite

```bash
pnpm exec vitest run \
  tests/unit/meetingNotesBudget.test.ts \
  tests/unit/meetingNotesHierarchy.test.ts \
  tests/unit/meetingNotesPipeline.test.ts \
  tests/unit/meetingNotesTruncationRecovery.test.ts \
  tests/unit/meetingNotesAuditRepair.test.ts \
  tests/unit/meetingNotesGuardrails.test.ts \
  tests/unit/meetingNotesCancellationContext.test.ts \
  tests/unit/meetingNotesStageCache.test.ts \
  tests/unit/meetingNotesProviderRouting.test.ts \
  tests/unit/meetingNotesScheduler.test.ts \
  tests/unit/meetingAnalysisRuns.test.ts \
  tests/unit/dbMeetingAnalysisRuns.test.ts \
  tests/unit/downstreamProcessingPresentation.test.ts \
  tests/unit/MeetingViewProgressiveReveal.dom.test.tsx
```

Expected: all pass.

### Step 2: Existing semantic and source-grounding gates

Run the existing saved-response/manual suites named by the repository, including:

```bash
pnpm run test:manual -- tests/manual/meetingNotesEditorAcceptance.test.ts
pnpm run test:manual -- tests/manual/meetingNotesLocalGuardrailsAcceptance.test.ts
pnpm run benchmark:meeting-notes-quality
```

Use the established reviewed-score, exact-evidence, false-positive/negative, commitment, terminology, and malformed-contract comparisons. Provider benchmark runs must use the accepted local model and recorded seed(s). A schema pass without semantic parity is not acceptance.

### Step 3: Repository checks

```bash
pnpm exec tsc --noEmit
pnpm exec biome check electron/llm electron/meetingAnalysisRuns.ts electron/meetingNotesScheduler.ts electron/db.ts electron/main.ts src/components/features/downstreamProcessingPresentation.ts src/components/features/MeetingView.tsx src/types.ts tests/unit tests/manual scripts
pnpm run changelog:check
pnpm run audit:high
git diff --check
```

Run `pnpm run build` only after focused tests pass. Because `better-sqlite3` ABI can flip between Node tests and Electron, finish Electron delivery with:

```bash
pnpm run fix-sqlite-abi
pnpm run ensure:sqlite-abi
pnpm run package:verify-runtime
```

Expected: all commands pass with fresh output. Record exact test-file/test counts and any environment-limited checks.

### Step 4: Add the changelog fragment

Document user-visible queue truth, bounded speed/recovery outcome, privacy-safe local metrics, and preservation of prior notes. Do not include private benchmark IDs/content.

### Step 5: Commit

```bash
git add docs/changelog/entries/2026-08-31-698-bounded-meeting-notes-latency.md
git commit -m "docs(changelog): record bounded notes latency (#698)"
```

## 12. Pre-PR review and release handoff

### Step 1: Review the complete diff

```bash
git status --short --branch
git diff --stat master...HEAD
git diff --check master...HEAD
git log --oneline master..HEAD
```

Confirm no private manifest, report, DB path, meeting ID, transcript, prompt, notes, participant, or audio path is tracked:

```bash
git ls-files | rg 'meeting-notes-latency|\.private|\.artifacts'
```

Expected: only source/test/docs files are listed; no private artifacts.

### Step 2: Adversarial review checklist

Review specifically for:

- stale queued work publishing after transcript/user-note changes;
- cancellation lost inside recovery or `AbortSignal.any`;
- queue positions drifting after coalescing/cancel/failure;
- secondary extraction starving or blocking primary notes;
- Ask Pluto preemption causing whole-meeting restart;
- metrics accidentally accepting strings or raw provider objects;
- history retention deleting active rows;
- prior notes/user edits overwritten on failure;
- audits or inherited-commitment validation skipped on recovery paths;
- feature flags changing fingerprint/reuse identity incorrectly.

### Step 3: Open the PR

Push only the isolated branch after checking that no unrelated commits would publish. Create a PR linked to #698 with:

- baseline and candidate aggregate table;
- exact quality/lifecycle verification evidence;
- rendered queue-state screenshots using non-private fixture data;
- explicit #695 scope boundary;
- rollback flags and behavior;
- disclosure of any checks not run.

Do not close #698 until the implementation commit is on `origin/master`, the latency and quality gates are evidenced, and final acceptance comments contain no unresolved blocker.

## Execution handoff

This plan is ready for implementation in `/Users/metagrover/Desktop/pluto/.worktrees/698-bounded-notes-latency` on `codex/698-bounded-notes-latency`.

Recommended execution order is exactly Tasks 1–12. Tasks 1–4 establish a trustworthy baseline before behavior changes; Tasks 5–6 reduce model work and wasted retries; Tasks 7–9 improve burst completion and queue truth; Tasks 10–12 decide promotion and ship only after speed and trust gates both pass.
