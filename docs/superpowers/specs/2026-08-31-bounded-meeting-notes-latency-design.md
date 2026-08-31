# Bounded meeting-notes latency

**Status:** Approved direction, formalized for implementation

**Issue:** [#698 — Bound time-to-trusted-notes for typical meetings](https://github.com/metagrover/pluto/issues/698)

**Related:** #695 owns thermal admission and cooling; #647 and #656 own adjacent cancellation and concise-synthesis concerns.

## Product outcome

Pluto should generate trustworthy notes for a typical 30-minute meeting in a bounded, observable amount of time. A user who regenerates several meetings should see which meeting is queued, which is generating, and when each completes. A failed regeneration must leave previously published notes intact.

The promotion gate is a **minimum 50% reduction in median isolated time-to-published-notes for the fixed 30-minute benchmark**, measured on the same warm Gemma 4 12B model and reference M1 Pro. The speed gate is subordinate to the existing semantic-fidelity and source-grounding gates: a faster untrusted document does not count as success.

## Current behavior and why it is slow

The current hierarchy planner sizes every source leaf against three hypothetical requirements at once:

1. the leaf writer request;
2. the leaf audit request; and
3. a future merge request containing duplicated source and three writer-sized output reservations.

That third constraint over-fragments ordinary meetings before Pluto knows what the leaf drafts contain. Recent planning evidence produced eight to nine leaves for meetings around 30 minutes. With one writer and one audit per leaf and one writer and one audit per merge, `L` leaves require approximately `4L - 2` model calls:

| Planned leaves | Model calls | Observed/estimated consequence |
| ---: | ---: | --- |
| 8 | 30 | Roughly 45–55 minutes at recent 61–102 second call times |
| 9 | 34 | Roughly 45–55 minutes at recent 61–102 second call times |
| 13 | 50 | A 45-minute source can remain active beyond 50 minutes |

All Ollama work goes through one serialized task gate. The gate selects the highest priority first and is FIFO within equal priority. Notes are currently queued one model call at a time, so four equal-priority meeting runs interleave writer, audit, and merge calls. This is neither full parallelism nor whole-meeting FIFO: it is serialized inference with stage-level round-robin-like behavior caused by each continuation rejoining behind already queued equal-priority work.

For four equal-cost meetings, stage interleaving makes most users wait near the total batch duration before any document is published. Whole-meeting scheduling will not reduce total GPU work by itself, but it changes completion times from approximately `4T, 4T, 4T, 4T` toward `T, 2T, 3T, 4T`; mean completion time falls from about `4T` to `2.5T`, and the first document arrives near isolated latency.

## Scope

This work includes:

- privacy-safe run and model-stage metrics;
- a reproducible isolated and burst benchmark;
- independent leaf and concrete-merge capacity planning;
- bounded recovery for writer, audit, and merge output truncation;
- one-active-primary meeting scheduling with explicit work classes;
- truthful queued/generating state and manual queue position;
- release gates covering latency, trust, cancellation, and publication safety.

This work does not include:

- changing the configured notes model;
- increasing Ollama parallelism;
- weakening or removing source audit by default;
- rewriting the notes prompt or shrinking output budgets without evidence;
- changing recording/transcription behavior;
- implementing thermal admission or cooldown policy from #695;
- uploading diagnostics or private meeting content;
- automatically regenerating existing meetings during rollout.

## Performance model

Each part has a distinct effect:

| Change | Expected speed effect | What it does not do |
| --- | --- | --- |
| Separate leaf capacity from merge capacity | Reduces leaf count and therefore writer/audit/merge calls; target is 8–9 leaves down to 4 or fewer for the fixed 30-minute case, which changes 30–34 calls to 14 or fewer | Does not change model quality contracts |
| Node-local truncation recovery | Avoids throwing away all completed siblings and restarting an entire run after one bounded work unit fails | Does not guarantee every document fits the fixed output contract |
| Whole-meeting scheduler | Publishes one burst item near isolated latency and reduces average completion time | Does not reduce total model work on its own |
| Work-class priorities | Keeps Ask Pluto responsive and prevents secondary/background work from delaying primary notes | Does not make a model call decode faster |
| Metrics and queue presentation | Makes regressions, queue delay, and true bottlenecks visible | Does not directly improve inference speed |

The first implementation retains writer plus audit for every leaf and every merge. An audit-count reduction is explicitly deferred. If capacity correction and local recovery do not clear the 50% gate, a separate evaluated experiment may compare:

- audit leaves and only the final merge (`3L` calls for a balanced hierarchy); or
- deterministic intermediate validation plus a final source audit (`2L` calls).

Neither variant may ship from this issue without passing the same semantic, exact-evidence, terminology, commitment, and malformed-output gates.

## Architecture

### 1. Privacy-safe run metrics

Add `electron/llm/meetingNotesRunMetrics.ts` as the single definition of the metrics contract and collector. The collector records only counts, enums, and durations:

```ts
export type MeetingNotesStageMetric = {
  sequence: number;
  task: NotesTask;
  outcome: 'complete' | 'preempted' | 'truncated' | 'failed' | 'cancelled';
  queueWaitMs: number;
  modelMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type MeetingNotesRunMetric = {
  schemaVersion: 1;
  reason: 'automatic' | 'manual';
  status: 'queued' | 'running' | 'published' | 'failed' | 'cancelled';
  sourceSegmentCount: number;
  sourceCharacterCount: number;
  plannedLeafCount: number | null;
  generatedNodeCount: number;
  repairCount: number;
  repartitionCount: number;
  queueMs: number;
  modelMs: number;
  totalMs: number;
  stages: MeetingNotesStageMetric[];
};
```

The validator rejects unknown string fields and caps `stages` at the existing 128-node hierarchy limit times two calls. It never accepts transcript text, prompts, generated notes, titles, participant names, audio paths, source spans, meeting IDs inside JSON, or provider response bodies.

Persist terminal metrics in a local history table so Pluto can answer “how long does a 30-minute meeting take on average?” from actual device history rather than stdout:

```sql
CREATE TABLE IF NOT EXISTS meeting_analysis_run_history (
  run_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meeting_analysis_run_history_completed
  ON meeting_analysis_run_history(completed_at DESC);
```

Keep the newest 100 terminal records globally. Explicit meeting deletion removes its history even if SQLite foreign keys are unavailable. The reporting path reads this table read-only and emits duration buckets and aggregate numbers only.

The current `meeting_analysis_runs` row gains `queue_position INTEGER`. `notes_status='running'` remains the lifecycle status for compatibility; `stage='queued'` plus a non-null position distinguishes admission wait from `stage='notes_writer'|'notes_audit'|'notes_merge'`. Terminal transitions clear the position. Startup recovery marks stale queued or running rows interrupted without deleting prior notes.

`UnifiedLLMProvider` reports queue-start, model-start, and terminal model metadata through callbacks instead of relying on packaged-app console output. Hosted providers use the same lifecycle callback even when token counts are unavailable.

### 2. Reproducible benchmark and local averages

Add a private-manifest benchmark that invokes the production pipeline without publishing results. The manifest contains opaque case keys and local meeting IDs; it remains ignored and never enters Git. The report replaces meeting IDs with case keys and contains only source size, duration bucket, plan size, stage timings, outcome, and error category.

The benchmark supports:

- isolated 15-, 30-, and 45-minute cases;
- a fixed 30-minute case repeated three times for a median;
- a four-meeting simultaneous burst through the production scheduler;
- a warm-model preflight that is reported separately from timed runs;
- baseline and candidate JSON reports with the same model, context, seed, and fixture order.

A second read-only report summarizes organic history into `<20m`, `20–40m`, and `>40m` meeting-duration buckets. It reports sample count, mean, median, p90, queue time, model time, call count, truncation rate, and publish rate. Fewer than three samples displays “not enough evidence” rather than an average.

### 3. Leaf capacity independent of merge capacity

Keep direct-mode planning unchanged. For hierarchical mode, `planNotesLeaves` should answer only: “Can this source window complete its writer and audit within the context budget?” It must not create a hypothetical merge prompt or duplicate the leaf source.

After all audited leaf drafts exist, the existing merge frontier evaluates actual pairs using their real compact drafts, inherited commitments, and referenced evidence. If a pair does not fit, `splitNotesDraftForMerge` repacks that concrete node without rewriting claims or source spans. Existing limits remain `maxDepth: 8` and `maxNodes: 128`.

Every plan emits `plannedLeafCount`; every completed hierarchy emits actual node and call counts. Promotion is based on end-to-end time, not the planner estimate alone.

### 4. Bounded node-local truncation recovery

Transport truncation is distinct from parse-invalid output. Keep the existing one contract-repair attempt for parse failures. Introduce a stage-aware work-unit wrapper for `notes_output_truncated`:

1. Retry the affected request once with the same contract and an explicit compact-response instruction. Do not lower the output cap or omit required fields.
2. If a leaf writer or leaf audit truncates again, bisect only that leaf at a source-segment boundary (falling back to a safe UTF-16 span boundary), process its children, and merge them back into the existing frontier.
3. If a merge writer or merge audit truncates again, repack only that merge node with `splitNotesDraftForMerge`, return its children to the frontier, and select smaller concrete pairs.
4. Preserve completed sibling nodes and validated stage-cache entries. Do not restart the meeting from leaf zero.
5. Stop when depth reaches 8, generated nodes reach 128, or the same minimal work unit truncates twice. Fail with `notes_repartition_exhausted` and preserve prior published notes.

Cancellation is checked before every retry, split, and model request. A cancellation never becomes a truncation or retry failure. Invalid source spans, dropped inherited commitments, malformed contracts after repair, and guardrail failures remain hard failures and are never routed through repartition recovery.

Increase the in-memory `NotesStageCache` capacity from four to 64 validated writer/merge drafts, retain the 15-minute TTL, and keep structured clones. This is intentionally memory-only because cached drafts contain private note content. It supports local retry without writing draft text to the metrics table.

### 5. Whole-meeting scheduling and work classes

Add `electron/meetingNotesScheduler.ts`. It owns admission of primary note runs and permits exactly one active primary meeting. Same-fingerprint requests for the same meeting continue to coalesce in `meetingAnalysisRuns.ts`.

Queue policy:

| Work | Meeting scheduler | Ollama gate priority | Preemptible |
| --- | --- | ---: | --- |
| Ask Pluto live/standard/deep | Bypasses meeting scheduler | 30 | No |
| Manual notes regeneration | FIFO within manual queue | 20 | At model-call boundaries by Ask Pluto/cancellation |
| Automatic post-meeting notes | FIFO behind manual | 15 | At model-call boundaries by Ask Pluto/manual admission after current meeting |
| Project scope review | Bypasses meeting scheduler | 15 | Yes, unchanged product behavior |
| Meeting secondary extraction | Starts after publication, behind any queued primary notes | 5 | Yes |
| Knowledge/commitment background | Bypasses meeting scheduler | 0 | Yes |

Manual work does not interrupt an active automatic meeting mid-model-call or discard its completed nodes. It moves ahead of queued automatic meetings. Ask Pluto can cooperatively preempt a resumable notes call through the existing gate; the notes work unit resumes from validated cache rather than restarting the whole meeting.

Recording does not share the LLM gate. Starting or active recording must prevent new secondary/background LLM admission by consulting the existing capture/transcription pause state. Thermal admission remains in #695.

The scheduler exposes a snapshot callback after every enqueue, admit, cancel, finish, and reorder. The coordinator writes `stage='queued'` and one-based `queue_position` to current rows and emits the existing `MEETING_NOTES_UPDATED` event. It rechecks publication revisions after admission, before generation, and before publish so time spent queued cannot make stale input publishable.

### 6. Truthful presentation

Extend `getDownstreamProcessingPresentation` with queued information:

```ts
| { state: 'queued'; title: string; detail: string; position: number }
```

Copy:

- manual position 1: “Notes are next” / “Another local task is finishing.”
- manual position N: “Notes are queued” / “Position N in the local notes queue.”
- generating: retain the existing grounded-notes preparation language.

When previous notes exist, keep them visible and show the compact queued/generating status next to the regeneration control. When no notes exist, use the existing in-column skeleton with the queued detail. Do not show ETAs until enough local history exists and prediction error has been evaluated; queue position is truthful, whereas an early ETA would not be.

## Preserved trust and lifecycle contracts

The following are release invariants:

- immutable source revision and exact source-span validation;
- writer plus source audit on every production node in the initial delivery;
- inherited action/decision conservation and explicit dispositions;
- terminology provenance and guardrail enforcement;
- one parse-repair attempt and strict malformed-contract failure;
- subscriber cancellation and whole-run abort when no subscribers remain;
- same-fingerprint coalescing without duplicate publication;
- publication only when run, input, source, eligibility, and user-note revisions remain current;
- atomic publish before secondary work;
- previous notes and user edits remain available after failure or cancellation;
- no private content in committed fixtures, metrics, reports, or GitHub artifacts.

## Promotion and rollback

Implementation is delivered in three independently reviewable slices:

1. metrics, history, benchmark, and queue-state plumbing;
2. capacity correction and node-local truncation recovery;
3. scheduler, work classes, and queued presentation.

The initial capacity behavior is guarded by `MEETING_NOTES_CAPACITY_V2` during development. The scheduler is guarded by `MEETING_NOTES_SCHEDULER_V1`. Flags default off until the candidate passes deterministic tests and real-provider benchmarks; the final shipping commit removes fallback paths or turns the accepted behavior on by default and records the decision in `docs/decisions.md`.

Promotion requires all of the following on the same commit:

- fixed 30-minute warm median is at least 50% faster than baseline;
- no isolated benchmark case exceeds 128 nodes or fails from truncation/context;
- burst first completion is no more than 1.25× candidate isolated 30-minute median;
- burst output order matches manual-before-automatic FIFO policy;
- existing semantic-fidelity reviewed score does not decline;
- exact-evidence precision, commitment recall/precision, terminology, and malformed-output suites show no regression;
- cancellation, stale publication, prior-note preservation, and startup recovery tests pass;
- no transcript, title, note, prompt, participant, audio path, or raw response appears in persisted metrics or report output.

Rollback disables the two behavior flags while retaining privacy-safe metrics and schema additions. No meeting content migration is required. Existing notes remain the source of truth throughout.
