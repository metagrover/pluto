# Design Spec: Proposal-First Memory Dreaming Engine

**Issue:** [#586](https://github.com/metagrover/pluto/issues/586)
**PR:** [#587](https://github.com/metagrover/pluto/pull/587)
**Original date:** 2026-08-04
**Revised:** 2026-08-11
**Status:** Approved direction; implementation pending

## 1. Problem

Pluto derives knowledge from one meeting at a time. That preserves source boundaries, but accumulated knowledge can become fragmented:

- the same entity may appear under multiple names;
- a later meeting may supersede an earlier project state;
- summaries can grow as disconnected snippets;
- user corrections may not constrain later synthesis consistently;
- old, low-value material can crowd current context.

Cross-meeting consolidation is a higher-risk operation than ordinary summarization. A false merge or incorrect state transition can make one unsupported inference look like durable truth everywhere Pluto uses that knowledge. The engine therefore needs less model authority, not more.

## 2. Outcome

Pluto periodically builds bounded evidence clusters while the app is idle and asks a local model for structured consolidation proposals. Deterministic code validates those proposals against immutable source evidence and graph invariants. Safe proposals can be reviewed and applied transactionally, and every applied change can be restored exactly.

This design does not ship the engine. It defines the contracts and delivery gates implementation must satisfy.

## 3. Product principles

1. **Evidence before synthesis.** Every semantic claim points to supplied source records. Model confidence is not evidence.
2. **Proposals before mutation.** The model never writes to SQLite or chooses identifiers outside its bounded input.
3. **Ambiguity is a valid result.** `unresolved` and `no_change` are better than forced consolidation.
4. **Risk controls authority.** Entity identity, temporal state, archival, deletion, and corrections require review initially.
5. **Episodic evidence is immutable.** Dreaming operates on derived semantic state only.
6. **Restoration is exact.** A Dream Log entry is not a rollback mechanism unless it preserves enough prior state to restore the graph.
7. **Foreground work always wins.** Recording, transcript validation, and user-requested analysis preempt dreaming.
8. **Local and private.** Meeting text, evidence quotes, identities, and graph content never enter production logs or telemetry.

## 4. Model decision

Pluto keeps Phi for latency-sensitive foreground work. `qwen3.5:9b` is the preferred background dreaming candidate to evaluate because idle work can tolerate its higher latency and a local 2026-08-10 benchmark showed stronger exact evidence grounding:

| Model | Meeting-analysis score | Precision cases | Exact evidence support | Total benchmark time | Resident model |
| --- | ---: | ---: | ---: | ---: | ---: |
| `phi4-mini:3.8b` | 30/48 | 1/3 | 7/13 | 88.2 s | 3.1 GB |
| `qwen3.5:9b`, thinking disabled | 30/48 | 2/3 | 13/13 | 207.4 s | 5.5 GB |

This is a candidate selection, not a quality claim. Qwen still produced false commitments in exploratory material and did not improve the aggregate meeting-analysis score. The dreaming benchmark must compare it with Phi and at least one credible local alternative before the default is locked.

For strict JSON output, the final Qwen pass uses thinking disabled unless a separately tested two-pass design reserves independent reasoning and final-output budgets. A hidden reasoning stream must never consume the JSON token budget.

## 5. Architecture

```text
Immutable meeting evidence          Derived knowledge state
           |                                  |
           v                                  v
  Revision-safe cluster builder ----> bounded cluster package
                                             |
                                             v
                                  Qwen synthesis proposal
                                             |
                                             v
                                  deterministic validator
                                   | rejected/unresolved
                                   v
                                  persisted proposal
                                             |
                                  review and risk policy
                                             |
                                             v
                                  transactional reconciler
                                             |
                                             v
                              applied snapshot + Dream Log
```

### 5.1 Deterministic cluster builder

The cluster builder:

- selects dirty knowledge documents, working-memory snapshots, entities, and relationships using durable revisions or source cursors;
- gathers bounded one-hop neighbors and chronological evidence records;
- generates alias and temporal-conflict candidates using deterministic rules;
- includes active user corrections as explicit constraints;
- assigns stable IDs to every supplied record;
- records the exact source revision at claim time;
- never places unrestricted database access or arbitrary transcript search behind the model call.

A completed run clears dirty state only when the current record revision still equals the claimed revision. New changes made during a run remain dirty.

### 5.2 Synthesis engine

The synthesis engine receives one bounded cluster and may propose:

- `entity_alias`: two supplied entities likely refer to the same real entity;
- `temporal_transition`: a supplied state was explicitly superseded or resolved;
- `narrative_refresh`: a source-backed summary over existing facts;
- `archive_candidate`: material may be stale or low-value, for review only;
- `unresolved`: evidence conflicts or is insufficient;
- `no_change`: the cluster is already coherent.

Every proposal contains only supplied graph IDs, source IDs, evidence references, and a reason. Narrative facts carry their own evidence references. The model cannot emit database operations.

### 5.3 Deterministic validator

The validator rejects output when:

- the schema is malformed or truncated;
- an identifier was not supplied in the cluster;
- an evidence reference cannot resolve to the cited source;
- a quote or fact fails the documented evidence-normalization rule;
- a correction is ignored or contradicted;
- a transition violates allowed state semantics;
- a merge creates a self-edge, duplicate invariant violation, or provenance loss;
- the output contains mutually inconsistent proposals;
- the run was cancelled, its lease expired, or any claimed source revision changed.

Rejected output is recorded through content-free categories and counts. It never appears as an applied or successful consolidation.

### 5.4 Proposal store and reconciler

Validated proposals are persisted separately from the live semantic graph. The reconciler applies only proposals permitted by the risk policy and current review state.

Application uses one SQLite transaction that:

1. rechecks proposal status, lease, source revisions, and graph preconditions;
2. stores complete prior state for every affected row and association;
3. applies the semantic change;
4. stores the complete resulting state;
5. advances proposal and run status;
6. preserves immutable episodic evidence;
7. marks downstream working-memory views dirty for regeneration.

No partial graph change survives a failed transaction.

## 6. Persistence contracts

Exact column names can follow existing `electron/db.ts` conventions, but the logical model requires the following.

### 6.1 Dreaming run

```typescript
type DreamingRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'proposed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reverted';

interface KnowledgeDreamingRun {
  id: string;
  triggerType: 'idle' | 'manual';
  status: DreamingRunStatus;
  model: string;
  promptVersion: string;
  generationConfig: Record<string, unknown>;
  leaseToken: string;
  sourceRevision: string;
  contentFreeMetrics: Record<string, number | string | boolean>;
  startedAt: string;
  completedAt?: string;
  errorCategory?: string;
}
```

### 6.2 Proposal

```typescript
type DreamingProposalKind =
  | 'entity_alias'
  | 'temporal_transition'
  | 'narrative_refresh'
  | 'archive_candidate';

type DreamingProposalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'reverted'
  | 'invalidated';

interface KnowledgeDreamingProposal {
  id: string;
  runId: string;
  clusterId: string;
  kind: DreamingProposalKind;
  risk: 'low' | 'high';
  status: DreamingProposalStatus;
  affectedIds: string[];
  evidenceRefs: Array<{ sourceId: string; evidenceId: string }>;
  proposalPayload: unknown;
  validationVersion: string;
  reviewedAt?: string;
  appliedAt?: string;
}
```

### 6.3 Applied snapshot

An applied snapshot stores canonical serialized before-and-after rows for every affected node, edge, document, summary, provenance record, confidence field, archive marker, and source association. Counts, sentence totals, loser IDs, or reassigned edge IDs alone are insufficient.

Snapshots include:

- the graph revision at application;
- the exact affected-row set;
- before and after hashes;
- dependency information for later runs;
- a restoration eligibility result.

If later mutations make exact restoration unsafe, the UI disables one-click revert and explains that a new compensating proposal is required.

## 7. Initial risk policy

### Low risk

An evidence-preserving narrative refresh may become auto-applicable only after the dreaming benchmark passes. It must not delete facts, alter identity or temporal state, remove provenance, override a correction, or affect unrelated records. Complete prior state is still required.

### High risk

The following require explicit review initially:

- entity merge or split;
- relationship rewrite;
- temporal transition;
- correction override;
- archival or deletion;
- any proposal with conflicting or incomplete evidence.

The first shipped release may choose review-first for every proposal. Broader automation requires a later decision-log update supported by benchmark and dogfood evidence.

## 8. Scheduling and resource safety

Idle dreaming begins only when:

- the app has been idle for the configured interval;
- the machine is on AC power for automatic runs;
- no recording, transcript validation, post-meeting analysis, or other foreground Ollama request is active or queued;
- memory and thermal pressure are within tested bounds;
- no other dreaming run owns the lease.

The coordinator:

- processes bounded clusters sequentially;
- rechecks eligibility between clusters;
- cancels immediately when foreground work begins;
- invalidates late responses with the lease token;
- persists finite terminal states across shutdown and startup;
- unloads Qwen promptly after completion or cancellation instead of using the foreground one-hour keep-alive;
- caps cluster size, context, output, retries, per-cluster time, and total run duration.

Manual runs may relax idle and AC requirements, but never recording priority, memory safety, validation, or mutation policy.

## 9. Dream Log UX

The Knowledge Workspace exposes a consolidation history and review surface. Users can distinguish:

- processing;
- proposed changes awaiting review;
- applied changes;
- rejected or invalidated proposals;
- cancelled or failed runs;
- reverted changes.

Each proposal shows its change type, affected records, source meetings, evidence, ambiguity, risk tier, and current state. Review supports individual decisions and safe batching. The UI does not call a run completed when structured generation fell back to an empty result.

## 10. Corrections and decay

User corrections are authoritative constraints, not optional prompt context. A proposal contradicting an active correction is invalid unless the product introduces a separate explicit correction-review flow.

Time-based decay is only a candidate signal. A fixed formula such as `saliency * 0.95^days` cannot archive material by itself because rare knowledge may remain important. Archive proposals require provenance, current-use signals, correction checks, and review initially.

## 11. Evaluation gate

The maintained benchmark invokes the real production provider, prompts, schema, and validator with content-free reporting.

Human-reviewed fixtures cover:

- true aliases and look-alike non-duplicates;
- renamed projects;
- explicit temporal transitions and competing proposals;
- later corrections and negated facts;
- stale facts and rare-but-important entities;
- contradictory meetings;
- invalid identifiers and missing evidence;
- cancellation and source-revision races;
- exact application and restoration.

Metrics include:

- merge precision and recall;
- false-merge count;
- temporal-state accuracy;
- correction adherence;
- unsupported-inference rate;
- exact evidence support;
- structured-output and fallback rate;
- latency and memory pressure;
- cancellation and late-response rejection;
- restoration fidelity.

Release gates:

- zero false merges in the release fixture set;
- 100% resolvable evidence for every auto-applicable proposal;
- no schema fallback presented as success;
- no mutation after cancellation or revision drift;
- exact restoration for every applied fixture;
- safe operation on the supported 16 GB Apple Silicon baseline without degrading recording or post-meeting processing.

## 12. Relationship to #594

[Issue #594](https://github.com/metagrover/pluto/issues/594) owns shared local-model foundations: prompt consistency, evidence validation, explicit Ollama capabilities, structured-output budgeting, privacy-safe real-provider benchmarks, and cancellation semantics. This issue owns dreaming-specific schemas, fixtures, lifecycle, risk policy, reconciliation, restoration, and UI.

Deterministic cluster and persistence work can proceed independently. Model integration and trust decisions should reuse the #594 provider and evaluation work.

## 13. Non-goals

- Changing transcription engines.
- Cross-platform inference support in the first release.
- Sending private content to a cloud model.
- Letting model confidence substitute for source evidence.
- Automatically merging or deleting knowledge because a model recommends it.
- Treating high extraction volume as quality.
- Implementing the engine in this design PR.

## 14. Open decisions for implementation

- Whether the first release is review-first even for narrative refreshes.
- The bounded evidence-normalization rule for transcript formatting differences.
- How pending proposals interact with later runs over the same records.
- Which third local model joins Phi and Qwen in the benchmark.
- Whether Qwen is installed on demand when the user enables dreaming.
