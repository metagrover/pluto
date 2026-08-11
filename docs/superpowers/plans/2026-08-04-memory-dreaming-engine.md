# Proposal-First Memory Dreaming Engine Implementation Plan

**Issue:** [#586](https://github.com/metagrover/pluto/issues/586)
**Design:** `docs/superpowers/specs/2026-08-04-memory-dreaming-engine-design.md`
**Related foundation:** [#594](https://github.com/metagrover/pluto/issues/594)
**Status:** Ready for issue-sized implementation slices after this design PR lands

## Goal

Deliver a local background consolidation system that turns bounded cross-meeting evidence into inspectable proposals, validates every proposal deterministically, applies only risk-policy-approved changes, and restores applied changes exactly.

The model never receives direct database authority. Qwen is a candidate to benchmark, not a preselected autonomous decision-maker.

## Delivery rules

- Use issue-driven development. Split this parent outcome into focused implementation issues and PRs rather than landing the whole engine at once.
- Follow TDD for all lifecycle, validation, reconciliation, and persistence logic.
- Keep production diagnostics content-free.
- Preserve immutable meeting transcripts and episodic evidence.
- Reuse #594 provider capabilities and benchmark infrastructure instead of building a second Ollama transport.
- Do not enable auto-application until the dreaming-specific release gate passes and the decision log is updated.
- Re-run final verification on the final merged HEAD of every slice.

## Target architecture

```text
dirty revisions -> bounded cluster -> model proposal -> deterministic validation
                                                   -> persisted proposal
                                                   -> review/risk policy
                                                   -> atomic application
                                                   -> complete restoration snapshot
```

## Slice 1: Persistence types and lifecycle contract

**Likely files**

- Create: `electron/dreaming/types.ts`
- Test: `tests/unit/dreamingTypes.test.ts`
- Modify: `src/api/knowledgeWorkspace.ts` only if renderer-facing types belong there

### RED

Write tests that require:

- finite run states: queued, running, cancelling, proposed, completed, failed, cancelled, and reverted;
- proposal states: pending review, approved, rejected, applied, reverted, and invalidated;
- explicit proposal kind and risk tier;
- stable source and evidence references;
- model, prompt version, generation configuration, lease token, and source revision metadata;
- content-free error categories rather than raw model or evidence output.

### GREEN

Implement the smallest serializable types and runtime parsers. Reject unknown lifecycle states and unsafe payload shapes at the boundary.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingTypes.test.ts
```

## Slice 2: Database schema, proposal store, and stale-run recovery

**Likely files**

- Modify: `electron/db.ts`
- Test: `tests/unit/dreamingPersistence.test.ts`

### RED

Cover:

- idempotent schema migration;
- run and proposal round trips;
- revision and lease-token persistence;
- one active writer per cluster;
- stale running/cancelling leases resolving to a truthful terminal state on startup;
- no transcript text, evidence quote, identity, or model response in content-free metrics;
- foreign-key cleanup that cannot remove immutable meeting evidence.

### GREEN

Add tables and indexes following existing `electron/db.ts` migration conventions. Store proposal payloads and restoration snapshots separately from live knowledge state. Expose narrow prepared-statement helpers rather than raw SQL to the model coordinator.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingPersistence.test.ts
```

## Slice 3: Revision-safe dirty tracking

**Likely files**

- Modify: `electron/db.ts`
- Modify: `electron/knowledgeV2.ts`
- Modify: `electron/knowledgeSynthesis.ts`
- Modify: `electron/workingMemory.ts`
- Test: `tests/unit/dreamingDirtyTracking.test.ts`

### RED

Prove that:

- relevant semantic writes advance a durable revision or source cursor;
- claiming work records the exact revision;
- completion clears dirty state only when the revision is unchanged;
- a concurrent correction or meeting update remains dirty;
- failed and cancelled runs do not lose dirty work;
- marking derived knowledge dirty never mutates canonical transcript state.

### GREEN

Introduce the smallest revision-aware dirty contract compatible with current knowledge documents, corrections, entities, and working-memory snapshots. Avoid a single boolean when it cannot distinguish changes created during a run.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingDirtyTracking.test.ts
```

## Slice 4: Deterministic cluster builder

**Likely files**

- Create: `electron/dreaming/clusterBuilder.ts`
- Test: `tests/unit/dreamingClusterBuilder.test.ts`

### RED

Cover:

- bounded one-hop grouping;
- stable ordering and IDs;
- chronological source records;
- active corrections included as constraints;
- look-alike entities remaining separate candidates;
- cluster limits for nodes, evidence records, and estimated tokens;
- no unrestricted transcript search;
- no records outside the claimed revision set;
- deterministic output for the same database snapshot.

### GREEN

Build a content-bearing in-memory cluster package for local inference and a separate content-free metrics summary. Generate candidate pairs and conflicts deterministically. The model receives only supplied stable IDs.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingClusterBuilder.test.ts
```

## Slice 5: Dreaming fixture corpus and scorer

**Likely files**

- Create: `scripts/baselines/memory-dreaming/`
- Create: `scripts/lib/memory_dreaming_quality.js`
- Create: `scripts/evaluate_memory_dreaming_quality.js`
- Modify: `package.json`
- Test: `tests/unit/memoryDreamingQuality.test.ts`

### RED

Define human-reviewed expectations for:

- true aliases;
- similar but distinct entities;
- renamed projects;
- explicit temporal transitions;
- competing proposals and unresolved conflicts;
- later corrections and negated facts;
- stale facts and rare-but-important entities;
- unknown identifiers and unsupported evidence;
- cancellation, revision races, and restoration.

### GREEN

Implement a content-free scorer for merge precision/recall, false merges, temporal accuracy, correction adherence, unsupported inference, exact evidence support, schema/fallback rate, cancellation integrity, and restoration fidelity.

Add `pnpm run benchmark:memory-dreaming` for checked-in outputs and a separate opt-in real-provider mode for local model execution.

### Verify

```bash
pnpm exec vitest run tests/unit/memoryDreamingQuality.test.ts
pnpm run benchmark:memory-dreaming
```

## Slice 6: Shared Ollama capability prerequisite

**Owner:** #594 unless already shipped

Before the synthesis engine uses Qwen, verify the shared provider supports:

- explicit structured-output thinking control;
- task-specific context, output, timeout, and keep-alive policy;
- cancellation that destroys or invalidates the active request;
- model and generation-configuration provenance;
- malformed/truncated response classification;
- a final JSON budget independent from any optional reasoning pass.

Do not add Qwen model-name substring checks inside dreaming code. Use a provider capability or explicit task configuration.

### Gate

Focused provider tests from #594 pass and a Qwen structured probe completes without fallback using the intended final-output configuration.

## Slice 7: Structured synthesis contract

**Likely files**

- Create: `electron/dreaming/prompts.ts`
- Create: `electron/dreaming/synthesisEngine.ts`
- Modify: `electron/llm/analysisTypes.ts` only if the shared provider needs a new task type
- Test: `tests/unit/dreamingSynthesisEngine.test.ts`

### RED

Require:

- only supplied IDs in output;
- evidence references for every proposal and narrative fact;
- explicit `unresolved` and `no_change` results;
- correction constraints retained;
- no database-operation language in the schema;
- Qwen final structured pass with thinking disabled or a separately budgeted tested two-pass flow;
- malformed, truncated, timed-out, and cancelled output never becoming an empty successful run.

### GREEN

Implement one bounded-cluster call at a time through `UnifiedLLMProvider`. Persist model, prompt version, and generation configuration with the run. Keep prompt content out of logs.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingSynthesisEngine.test.ts tests/unit/unifiedProvider.test.ts
```

## Slice 8: Deterministic validator and proposal persistence

**Likely files**

- Create: `electron/dreaming/proposalValidator.ts`
- Create: `electron/dreaming/proposalService.ts`
- Test: `tests/unit/dreamingProposalValidator.test.ts`

### RED

Reject:

- unknown graph or source IDs;
- missing or unresolvable evidence;
- unsupported facts after documented normalization;
- ignored corrections;
- illegal temporal transitions;
- self-edges, duplicate invariants, and provenance loss;
- mutually inconsistent proposals;
- expired leases, cancelled runs, or changed source revisions.

Prove rejected output records only content-free categories and cannot reach approved/applied state.

### GREEN

Validate first, then persist proposals separately from live semantic state. Classify risk in deterministic code. Do not trust a model-provided confidence or risk label.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingProposalValidator.test.ts
```

## Slice 9: Transactional application and exact restoration

**Likely files**

- Create: `electron/dreaming/reconciler.ts`
- Create: `electron/dreaming/restoration.ts`
- Modify: `electron/db.ts`
- Test: `tests/unit/dreamingReconciler.test.ts`
- Test: `tests/unit/dreamingRestoration.test.ts`

### RED

Cover:

- risk-tier and review-state enforcement;
- precondition recheck at application time;
- complete before-and-after rows and associations;
- atomic merge, transition, summary refresh, and archive-candidate handling;
- downstream working-memory invalidation;
- rollback on injected database failures;
- exact restoration of nodes, edges, documents, summaries, provenance, confidence, archive state, and source associations;
- safe refusal when later runs make direct restoration invalid;
- immutable episodic evidence throughout apply and restore.

### GREEN

Implement application and restoration as explicit transactions. A diff with counts or reassigned IDs alone is not accepted as a restoration record.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingReconciler.test.ts tests/unit/dreamingRestoration.test.ts
```

## Slice 10: Coordinator, priority, and resource lifecycle

**Likely files**

- Create: `electron/dreaming/coordinator.ts`
- Create: `electron/dreaming/eligibility.ts`
- Modify: `electron/main.ts`
- Modify: `electron/serializedTaskGate.ts` only if shared priority/cancellation support is required
- Test: `tests/unit/dreamingCoordinator.test.ts`
- Test: `tests/unit/dreamingEligibility.test.ts`

### RED

Prove:

- automatic runs require idle state and AC power;
- manual runs still obey recording, foreground, memory, and mutation safeguards;
- recording, transcript validation, or foreground analysis preempts dreaming;
- eligibility is rechecked between clusters;
- late model responses cannot persist after cancellation;
- startup resolves stale leases;
- memory and thermal pressure delay or stop work;
- model unload occurs after completion, cancellation, and failure;
- cluster, context, output, retry, and total-run caps terminate predictably;
- only one run owns a cluster.

### GREEN

Process clusters sequentially under a generation/lease token. Integrate with current serialized local-model work rather than creating a competing queue. Use a dreaming-specific keep-alive that unloads Qwen promptly.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingCoordinator.test.ts tests/unit/dreamingEligibility.test.ts tests/unit/serializedTaskGate.test.ts
```

## Slice 11: IPC and Dream Log review UI

**Likely files**

- Modify: `electron/main.ts`
- Modify: Electron preload allowlist and browser fallback files used by current IPC conventions
- Modify: `src/api/knowledgeWorkspace.ts`
- Create: `src/components/KnowledgeGraph/DreamLogDrawer.tsx`
- Create: `src/components/KnowledgeGraph/DreamLogDrawer.css`
- Modify: `src/components/KnowledgeGraph/MainStage.tsx`
- Test: `tests/unit/dreamingApi.test.ts`
- Test: `tests/unit/DreamLogDrawer.test.tsx`

### RED

Cover:

- allowlisted start, list, review, apply, and restore IPC contracts;
- proposed/applied/rejected/invalidated/cancelled/failed/reverted presentation;
- evidence and affected-record disclosure without production logging;
- individual accept/reject and safe batch review;
- disabled actions for stale proposals and unsafe restoration;
- no success copy for fallback or empty analysis;
- keyboard, focus, loading, error, and reduced-motion behavior.

### GREEN

Build the smallest review-first surface within current Knowledge Workspace patterns. Avoid utility-class assumptions not present in Pluto's CSS system. Keep manual consolidation status truthful and interruptible.

### Verify

```bash
pnpm exec vitest run tests/unit/dreamingApi.test.ts tests/unit/DreamLogDrawer.test.tsx tests/unit/knowledgeMainStage.test.tsx
```

Perform real Electron visual acceptance before landing the UI slice.

## Slice 12: End-to-end model evaluation and controlled enablement

### Real-provider benchmark

Run Phi, Qwen, and the selected third local candidate through the exact production cluster builder, prompt, schema, validator, and scorer. Use deterministic seeds or a documented repeat count. Record:

- model tag and hardware;
- prompt and fixture revisions;
- context/output/temperature/thinking/keep-alive configuration;
- quality metrics;
- schema and fallback counts;
- latency and memory pressure;
- cancellation and unload behavior.

### Release gates

- zero false merges in release fixtures;
- 100% resolvable evidence for every auto-applicable proposal;
- zero post-cancellation mutations;
- zero dirty-revision loss;
- exact restoration for every applied fixture;
- no structured fallback presented as success;
- safe operation on the supported 16 GB Apple Silicon baseline;
- foreground recording and analysis remain responsive during attempted preemption.

### Dogfood

Use an isolated Pluto profile and content-free diagnostics. Review every proposal manually. Verify that a full run can be cancelled by recording start, resumed later without duplicate application, reviewed, applied, and restored.

Do not enable an auto-application tier until the benchmark passes and `docs/decisions.md` records the resulting policy. The first release may remain entirely review-first.

## Final verification for every shipping slice

```bash
pnpm test
pnpm run lint
pnpm run changelog:check
pnpm run audit:high
```

For model or lifecycle slices, also run:

```bash
pnpm run benchmark:meeting-notes-quality
pnpm run benchmark:memory-dreaming
```

Run the production Vite/Electron bundle when main-process, preload, IPC, or renderer code changes. Report existing repository-wide type errors separately; do not claim they were introduced or fixed without changed-file evidence.

## Traceability at completion

Each implementation PR must:

- link its child issue and parent #586;
- state which risk tier and lifecycle states it changes;
- include content-free verification evidence;
- update #586 when scope or gates change;
- record any durable policy change in `docs/decisions.md`;
- add one uniquely named changelog fragment when product behavior ships.
