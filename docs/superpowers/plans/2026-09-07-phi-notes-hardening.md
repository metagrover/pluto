# Phi Meeting Notes Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce accurate, complete, useful meeting notes efficiently with `phi4-mini:3.8b` on the 16 GB reference Mac, with measured source-capacity limits and no production routing change before fresh quality and integrated gates pass.

**Architecture:** Extract source-grounded inventories, then run one mandatory final editor over the complete original source and all inventory items. For bounded inputs, finish all leaf inventories before that meeting-wide editor; do not concatenate independently edited leaves. Reuse source validation, stage execution, cache, transport, and publication boundaries. Score actual visible document blocks through canonical provenance. Keep candidate behavior behind an explicit experiment configuration, including prompt guidance and preservation rules.

**Tech Stack:** Electron, TypeScript, Ollama structured JSON, Vitest, existing notes reconciliation/editor/grounding modules, opt-in private evaluation and disposable integration harnesses.

**Tracking:** [#788](https://github.com/metagrover/pluto/issues/788), with integrated resource acceptance under [#695](https://github.com/metagrover/pluto/issues/695).

**Revision:** September 7 engineering review incorporated. This document specifies implementation and evidence to collect; no threshold or review status below claims the experiment has run or passed.

---

## Scope, evidence, and promotion contract

Phi remains the notes candidate. The September 7 result was 27/36 independent agent-reviewed passes versus Gemma's 24/36, with approximately 4.2 times faster median latency. These were synthetic semantic cases, and agent review was not blinded human acceptance. The inspected twelve cases are development/regression evidence and must never become promotion holdout again.

The work covers notes generation and its downstream effects. It does not select models for chat, dreaming, project synthesis, or cross-meeting comparison. Gemma's production routing **and default prompt behavior** remain unchanged. Candidate-only guidance, preservation, caching, and error policy require the experiment option. A shared production prompt change needs separate validation and delivery.

Promotion requires every frozen gate:

| Dimension | Required result |
| --- | --- |
| Critical integrity | Zero unsupported critical identity, owner, commitment, deadline, condition, correction, withdrawal, or evidence-association claims in any inspected output, including rejected outputs |
| Factual quality | Atomic factual precision at least 98%; critical-fact recall 100%; action/decision recall at least 95%; no more than two percentage points non-critical recall regression versus paired Gemma control |
| Completion | At least 95% accepted completion on the declared supported suite; every semantic case accepted at least 2/3 times, and each ordinary-capacity case accepted at least 2/3 times in each cold/warm condition |
| Human usefulness | Median at least 4/5; no critical case below 3/5; two human reviewers available, at least 25% double-reviewed and every dispute/critical error double-reviewed |
| Evidence/publication | All accepted factual blocks resolve to current original source; zero wrong-model, residency, unsafe-truncation, stale-source, privacy, or publication-provenance failures |
| Ordinary latency | Each declared cold/warm ordinary cell has at least 20 comparable runs, median accepted time at most 120 seconds, empirical p95 at most 240 seconds; paired median at least 30% faster than control unless control already meets the absolute target |
| Integrated behavior | All Task 7 downstream, responsiveness, recording, resource, recovery, and publication gates pass |

Report macro per-case and micro claim metrics. Precision counts **all** adjudicated factual assertions, including extra claims absent from gold. Accepted means a completed pipeline result passing source/human adjudication, not valid JSON or automated triage. Compute content-quality metrics over produced outputs and completion over all scheduled attempts; no-output failures cannot count as successful recall. Report critical recall over outputs and over all attempts separately so the 100% content gate does not silently redefine the 95% completion gate. Show accepted-output latency alongside the entire scheduled attempt distribution, including observed/capped timeout durations; never select a speed winner using only survivors. Cold/warm ranks and quality gates must all pass independently.

Missing evidence means `incomplete`, not pass. Do not waive p95 for small samples, fill absent telemetry with zero, or change thresholds after viewing outputs. Identical generations are repeated executions, not independent semantic cases. Expected capacity rejections have a separately frozen partition; never reclassify an ordinary failure as out-of-capacity after a run.

## Execution and capacity design

```text
explicit notes experiment + frozen model/source/configuration
  |
  +-- option absent --> existing production path, unchanged
  |
  +-- source-first --> preflight complete source + inventory/editor budgets
                        |
                        +-- direct: one inventory writer
                        |
                        +-- bounded: up to three initial leaf writers
                        |              + at most one truncation-driven split
                        |              + canonical indexes, leaf-scoped checks
                        |
                        +-- validated inventories with unique application IDs
                        |
                        +-- one mandatory meeting-wide editor
                        |     complete original source + inventory shown once
                        |     retain material items or explain supported disposition
                        |
                        +-- strict source, coverage and final-state validation
                        |
                        +-- accepted projection --> revision-fenced publication

failed fit / exhausted budget / cancellation / invalid evidence
  --> explicit terminal failure; preserve prior published notes
```

Direct success uses two logical model calls. Bounded success uses up to three initial writers plus one final editor. One failed writer followed by two replacement writers raises the maximum to five writer attempts plus one editor: **six logical calls total**. Reserve the final editor call before starting or splitting another writer. At most one recovery split is allowed. The evaluator separately caps physical starts, including transport retries and preemption, at twelve per run.

Leaf inventories remain provisional until meeting-wide review. An early commitment may be cancelled, corrected, transferred, or renewed later. Leaf guards must not demand claims from unseen leaves or treat leaf-local state as final meeting state.

Use the complete original source in the final editor. Encode the inventory once with application IDs and opaque source labels; reference those IDs in preservation instructions instead of duplicating a draft and inherited block. Do not omit original source, cut the middle, select only cited evidence, or compress away unresolved inventory to fit. If the aggregate envelope cannot fit, fail with `notes_source_first_capacity_exceeded` and preserve prior notes. This is an explicit capacity failure, not accepted abbreviated notes.

Start with 16,384 context tokens, 2,048 writer-output tokens, the existing per-leaf source limit, and the existing editor output allowance. Measure the actual supported envelope on development capacity fixtures before holdout. If it cannot support the declared ordinary workloads, stop promotion and resolve capacity under #788/#695. Do not claim long-meeting coverage from six-turn examples or increase budgets without measured 16 GB resource evidence.

## File responsibility map

| Files | Responsibility |
| --- | --- |
| `tests/manual/fixtures/localIntelligenceEvaluationCases.ts` | Existing corpus, gold contracts, inspected-case partition |
| `tests/manual/fixtures/localIntelligencePhiNotesHeldOut.ts` (new) | Fresh semantic/capacity corpus and expected-rejection fixtures; no production imports |
| `tests/manual/fixtures/localIntelligenceNotesScoring.ts` (new) | Visible-block projection, canonical evidence matching, human-review packet data |
| `scripts/lib/local_intelligence_evaluation.ts` | Versioned experiment configuration, schedules, ledger validation, aggregation |
| `tests/manual/localIntelligenceEvaluation.test.ts` | Route activation, synthetic transport, real runs, private artifact persistence |
| `tests/unit/localIntelligenceEvaluation.test.ts`, `tests/unit/localIntelligenceEvaluationCases.test.ts`, `tests/unit/localIntelligenceNotesScoring.test.ts` (new) | Manifest, denominator, partition and scorer regressions |
| `electron/llm/meetingNotesTypes.ts`, `electron/llm/meetingNotesSchema.ts` | Experiment contracts, scope and candidate coverage/dispositions |
| `electron/llm/meetingNotesReconciliation.ts`, `electron/llm/meetingNotesHierarchy.ts` | Scoped parsing and candidate-only all-item preservation |
| `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesStageCache.ts` | Shared stage execution, cache admission, capacity, final editor |
| `electron/llm/meetingNotesEditor.ts`, `electron/llm/meetingNotesGuidance.ts` | Candidate-only guidance and nonduplicated inventory prompt |
| `electron/llm/unifiedProvider.ts`, `electron/llm/provider.ts` | Explicit option propagation; unchanged defaults |
| `electron/meetingAnalysisRuns.ts`, `tests/unit/meetingAnalysisRuns.test.ts`, `tests/unit/dbMeetingAnalysisRuns.test.ts` | Candidate-aware run/cache identity, disposable provider injection, revision-fenced publication regressions |
| `tests/manual/meetingNotesReconciliationAcceptance.test.ts` | Development diagnostic through the same candidate provider path |
| `tests/manual/localIntelligenceMixedWorkload.test.ts` (new) | Disposable application integration and downstream track |
| `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md` | Content-free development, held-out and integrated findings |
| `docs/changelog/entries/2026-09-07-788-phi-notes-hardening.md` | Implementation delivery fragment; no premature routing claim |

Extend the existing unit suites named in each task. Keep responsibilities in existing modules; do not introduce another provider or scheduler. Update the linked issue when execution begins with the finalized scope and gates. This local plan edit does not publish a GitHub message, alter product settings, or authorize running production data through a model.

### Task 1: Score visible blocks through canonical evidence

**Files:** Create `tests/manual/fixtures/localIntelligenceNotesScoring.ts` and `tests/unit/localIntelligenceNotesScoring.test.ts`; modify the existing cases, manual runner and their unit tests.

- [ ] **Step 1: Write positive and false-pass regressions**

Build positive fixtures through `acceptEditedNotes` and `projectAuditedNotes`, then mutate individual fields for negative tests. Cover a first fact projected as `topic.summary`, a later key point, an open question string, an action with `assignee`, and a decision with `decided_by`.

Reject an action present only in decision evidence; correct text with unrelated evidence; missing/stale provenance; invalid spans; text and owner/date split across different items; guessed owner when gold requires absence; positive modality replacing a condition; correct fact plus conflicting extra action; aggregate duplicates counted twice. Include the observed Lena, Nia/Luis, Ravi, unrelated-dashboard and unmet-condition failures. Keep these fixture entities out of production prompts.

- [ ] **Step 2: Verify the new tests fail**

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceNotesScoring.test.ts
```

Expected: FAIL because the new scorer/provenance adapter does not exist. Positive tests prevent a reject-everything implementation.

- [ ] **Step 3: Define notes-only gold contracts**

```ts
export type NotesProjectionExpectation = {
  kind: 'point' | 'action' | 'decision' | 'question';
  requiredTextTerms: string[];
  requiredEvidenceTerms: string[];
  forbiddenEvidenceTerms?: string[];
  owner?: string | null;
  due?: string | null;
};
export type NotesClaimScore = {
  id: string;
  critical: boolean;
  matchedBlockPath: string | null;
  projectionMatched: boolean;
  ownerMatched: boolean;
  dueMatched: boolean;
  provenanceMatched: boolean;
  evidenceMatched: boolean;
  passed: boolean;
};
```

Require `notesProjection` on meeting-notes gold, alongside existing source IDs/excerpts and modality. An omitted owner/due expectation is unconstrained; explicit `null` requires no assigned owner/deadline. Normalize whitespace/case and frozen equivalent forms only. Lexically missed valid paraphrases go to human adjudication; never add output-derived synonyms after holdout starts. Non-notes lanes retain their current scorer.

- [ ] **Step 4: Implement the actual projection adapter**

Use this mapping from `sourceMetadata` in `meetingNotesAudit.ts`:

| Visible field | Kind/metadata | Provenance key |
| --- | --- | --- |
| `topics[t].summary` | point, first in section | `topic:t:summary` |
| `topics[t].key_points[p].text` | point | `topic:t:point:p` |
| `topics[t].action_items[a]` | action; `assignee`, `due` | `topic:t:action:a` |
| `topics[t].decisions[d]` | decision; `decided_by` | `topic:t:decision:d` |
| `topics[t].open_questions[q]` | question string | `topic:t:question:q` |

Implement `scoreNotesGoldOutput(candidate, analysis, source)` using the exact canonical source supplied to generation. Require matching `generation_metadata.source_provenance.source_revision`; resolve each visible block's recorded spans against original source. Match expected source IDs/excerpts as well as evidence terms. Correct vocabulary in the wrong segment cannot pass. Cross-check inline action/decision evidence with those spans; do not invent inline evidence fields for points/questions.

Inspect overview, titles and recent-win prose for unsupported extra claims and provenance, but match required claims in their declared point/action/decision/question projections. Exclude `native_continuations:*`, completion aliases, `all_action_items`, and `all_decisions` from recall counts. Score visible assertion text separately from evidence quotes so quoting a rejected proposal is not automatically treated as endorsement.

Return per-claim results, unmatched visible blocks, provenance failures and forbidden matches. Matching gold never proves precision: human review covers every assertion, including unanticipated extra content and contradictions.

- [ ] **Step 5: Wire, verify and commit**

Replace only the notes lane's serialized-JSON scoring with `scoreNotesGoldOutput(candidate, analysis, source)`. Preserve `automatedTriageAccepted` and `reviewStatus: 'pending_human_review'` separately from final acceptance.

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceNotesScoring.test.ts tests/unit/localIntelligenceEvaluationCases.test.ts tests/unit/localIntelligenceEvaluation.test.ts
```

Expected: valid summary/question projections pass, false-pass mutations fail, other lanes retain behavior. Commit only these files with message `test: score visible notes through canonical provenance`.

### Task 2: Freeze fresh semantics and measured capacity fixtures

**Files:** Create `tests/manual/fixtures/localIntelligencePhiNotesHeldOut.ts`; modify existing evaluation cases, manifest contracts, and partition tests.

- [ ] **Step 1: Preserve historical cases as development evidence**

Relabel the twelve inspected September 7 IDs `development`, retaining text, IDs, gold semantics and failure IDs. Add projection expectations without rewriting transcript content. Tests enumerate the twelve IDs explicitly to prevent vacuous empty selections.

- [ ] **Step 2: Create twelve fresh semantic cases**

| Profile | Count | Contracts |
| --- | ---: | --- |
| short | 3 | Requester/recipient decoy with accepted owner; corrected deadline; declined proposal with negative decision and no action |
| ordinary | 4 | Final-turn commitment; unmet prerequisite with explicit no-action conclusion; withdrawn and retained tasks with reason; unrelated topics sharing names/dates |
| long/dense | 3 | Ownership handoff and superseded date across parts; decision separated from action by negative discussion; conditional-to-committed transition, cancellation and renewal across parts |
| adversarial/sparse | 2 | Many name/date decoys with one real commitment; unmet condition and explicit negative conclusion separated by unrelated material |

Use new entities and wording. Gold must include rationale, quantities, definitions, unresolved questions and material non-action facts. Semantic complexity and measured size are separate; a profile name alone never proves long-source coverage.

- [ ] **Step 3: Add eight ordinary-capacity cases and boundary fixtures**

Eight distinct cases represent 20–40 minute ordinary meetings within the declared supported envelope. Freeze duration provenance or synthetic assumptions, source characters, segment count, language, density, critical-item positions, expected writer parts, and budget estimates. Include natural disfluencies, unknown/ambiguous speakers, user-note emphasis and terminology hints without treating hints as evidence. Do not pad by repeating one filler sentence.

Use proposed source bands of four cases at 8,000–16,000 characters and four at 16,001–24,000. Validate these on development analogues before sealing. The larger cases must cross actual writer boundaries and exercise cross-leaf changes. Record measured tokens and editor fit at frozen settings. If these bands cannot be supported, the ordinary-capacity gate is blocked pending a documented capacity revision before holdout; do not shrink it after observing failures.

Add development/unit boundary fixtures for direct/bounded transition, maximum leaves, one truncation/repartition, source-fit but aggregate-inventory overflow, oversized individual segment, and explicit capacity rejection. Freeze at least two separate held-out expected-rejection fixtures asserting no publication and preservation of prior notes. Their predeclared membership excludes them from supported completion counts; report them separately.

- [ ] **Step 4: Assemble the suite explicitly and seal hashes**

Export `phiNotesHeldOutCases` (twelve semantics), `phiNotesOrdinaryCapacityCases` (eight capacity cases), and a separate rejection collection. Wire these exports into the selected notes suite; creating a file does not automatically add it to the old registry. Test unique IDs, partition isolation, source resolution, complete gold metadata, 3/4/3/2 semantic counts, eight capacity cases, size bands and expected execution paths.

Freeze separate literal SHA-256 values for corpus, rubric and schedule using canonical JSON. Calculate actual values from committed objects and have the corpus/rubric reviewed before held-out inference. Never calculate both sides of a hash assertion dynamically or auto-update snapshots. Task 2 assembles and checks the corpus; finalize its capacity expectations and schedule seal at Task 6 after development planner checks. Any holdout whose outputs inform tuning becomes development evidence permanently.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluationCases.test.ts tests/unit/localIntelligenceNotesScoring.test.ts tests/unit/localIntelligenceEvaluation.test.ts
```

Expected: exact counts, stable hashes, complete evidence and no partition overlap. Commit with message `test: freeze Phi notes semantics and capacity corpus`.

### Task 3: Add scoped reconciliation and all-item preservation

**Files:** Modify `electron/llm/meetingNotesTypes.ts`, `electron/llm/meetingNotesSchema.ts`, `electron/llm/meetingNotesReconciliation.ts`, `electron/llm/meetingNotesHierarchy.ts`, `electron/llm/provider.ts`, `electron/llm/unifiedProvider.ts`; extend reconciliation, hierarchy, routing and schema tests.

- [ ] **Step 1: Reproduce partial-leaf rejection**

Build a source with a fact in leaf one and an accepted action in leaf two. Leaf-one parsing must pass when its allowed spans contain only that fact. Omitting an action inside the admitted leaf must still fail. A citation outside the admitted leaf must fail even if it resolves in the full source. Preserve canonical indexes/revision; do not renumber a copied source.

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: new scoped-contract tests fail before implementation.

- [ ] **Step 2: Add option propagation and source scope**

Add `sourceFirstReconciliation?: boolean` to `GenerateMeetingNotesInput`, `LLMProvider.generateStructuredAnalysis` and `UnifiedLLMProvider.generateStructuredAnalysis`; pass it through unchanged. Reject incompatible configurations: source-first requires Ollama, compact mode and editor review, not deterministic-only. Never activate the route by inspecting the model name.

For candidate calls, resolve the installed model digest at provider admission and propagate it into generation/cache identity; reject a mismatch with the frozen experiment digest. A digest written only in an evaluator artifact does not protect the stage cache. Include the candidate option in both run fingerprint and completed-stage identities when using the application coordinator, so a control run cannot satisfy a candidate request through cached publication state.

Extend `parseReconciledSource(raw, source, allowedSpans?)`: resolve citations against unchanged canonical `source`, enforce admitted descriptors, and scope omission/condition/cancellation guards to `allowedSpans`. No-scope callers retain full-source behavior. Leaf validity is provisional; global state is checked after all inventories exist.

- [ ] **Step 3: Add schema and candidate-only preservation**

Add `reconciliation` to `NotesResponseContract`. Require exactly `facts`, `actions`, `decisions`, `questions`, with no additional properties. Each entry requires nonempty text and provided source labels; actions require nullable owner/due and decisions nullable owner. IDs are application-assigned after parsing. Test actual `createNotesWireRequest` labels and invalid-label rejection.

Generalize inherited validation for the candidate to protect every inventory item, including facts, negative outcomes, reasons and questions. Keep the existing production commitment validator unchanged when the experiment is absent. Retained items preserve application ID, kind, text, sources, owner and due. The final editor may organize headings/order and add supported missing items; it cannot silently paraphrase away inventory semantics.

Cancellation/supersession requires a source-backed disposition and visible explanation; deduplication requires a retained equivalent replacement with compatible evidence. Dispositions must target known IDs and admitted original evidence. Reject invented dispositions, missing replacements/explanations, and deletion merely to shorten notes. Reuse existing disposition structures, extending the candidate response contract only where coverage needs it. Schema-valid dispositions are not proof of semantic truth; strict guardrails and human source review remain required.

Add regressions for dropped unmet-condition fact, rationale and question; fabricated cancellation; changed owner/date; legitimate supersession; unrelated similarly named work preserved.

- [ ] **Step 4: Verify and commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesSchema.test.ts tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingNotesTransport.test.ts
```

Expected: scoped parsing and all-item coverage pass, default contracts unchanged. Commit with message `feat: define scoped source-first notes contracts`.

### Task 4: Run bounded inventories before mandatory meeting-wide editing

**Files:** Modify `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesStageCache.ts`, `electron/llm/meetingNotesEditor.ts`; extend pipeline, budget, stage-cache, cancellation and routing tests; update the manual reconciliation diagnostic.

- [ ] **Step 1: Write execution and lifecycle regressions**

Assert direct response contracts are `reconciliation, editor`; three-leaf success is `reconciliation, reconciliation, reconciliation, editor`. No per-leaf editor calls occur. Final input contains every original segment and inventory ID once. Test early commitment followed in another leaf by cancellation, corrected deadline, ownership transfer, cancellation then renewal, and an unrelated similar task that survives. Check final projections and provenance, not only prompt strings.

Cover cache hits/invalidation, post-response cancellation, pre-send fit rejection, reserved editor call, one successful split, denied second split, and final editor failure. Assert no partial publication and unchanged default `compact_draft, editor` behavior.

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesBudget.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts
```

Expected: candidate-specific tests fail before implementation.

- [ ] **Step 2: Reuse stage execution, not direct generation**

Adapt the existing `writeDraft`/`withOneRepair` boundary to accept an explicit response contract, parser and repair policy. Candidate generation includes pre/post cancellation, immediate encoded wire-fit assertion, `onStage`, logical-call admission, validated cache lookup/write, allowed-span validation on cache hits, source/model/configuration identity, error categorization and existing provider residency/physical-start observation. A direct `input.generate` helper without these behaviors is not acceptable.

Do not apply compact-draft recovery to reconciliations. Invalid JSON or guardrails fail closed; only transport-reported truncation permits the single repartition. Reuse a completed writer after preemption only when evidence text/spans/speakers, revision policy, model digest, context/output settings, prompt/schema/pipeline versions and experiment identity remain compatible. Never cache partial output. Test changed source, speaker, model, settings and default/candidate cache collisions.

- [ ] **Step 3: Reserve and verify the complete editor envelope**

Update both direct and bounded planning for source-first prompts. Reserve full original source, schema/instructions, worst-case aggregate writer output, application-ID/null-field conversion overhead, source-label encoding, editor output and safety margin. Supply the inventory once, referencing IDs in preservation instructions. Count output-item-dependent overhead, not merely original writer token allowance. Recheck the actual encoded prompt after inventories arrive.

Reject a provably impossible final editor before any inference. If actual valid inventories still exceed the bound, fail explicitly with `notes_source_first_capacity_exceeded`; never overflow, truncate inventory, publish a mechanical draft, or enter legacy hierarchy. Record estimated/actual sizes for development tuning.

- [ ] **Step 4: Run scoped writers and reconcile complete meeting state**

Prefix application IDs by leaf/recovery split; retain canonical spans. Finish all writer packets before one final editor. Supply chronological full original source, combined inventory and candidate preservation rules. Use strict full-source review followed by source-scope, all-item coverage/disposition, final-state and provenance checks. Project only through existing accepted-document boundaries.

The candidate final editor is mandatory. Optional-review timeout, exhausted calls, malformed audit or truncated editor output may not publish preliminary inventory. Preserve existing Gemma/default fallback behavior. If this stricter candidate misses completion targets, improve it on development evidence; do not count unedited inventory as accepted notes.

- [ ] **Step 5: Preserve budgets and terminal metadata**

Reserve one editor call within the six-call allocation. Allow one split only if two replacement writers plus final editor still fit. Track logical calls separately from physical starts and cache hits. Use a distinct version such as `notes-v30-source-first`, frozen before holdout.

Preserve explicit capacity, missing coverage, unsafe disposition, cancellation, timeout, truncation and exhausted-budget categories through existing retry handling. Do not convert timeout to user cancellation or reset durable attempt guards. Recheck source/configuration identity at publication. A stale result cannot replace valid old notes.

- [ ] **Step 6: Verify and commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesHierarchy.test.ts tests/unit/meetingNotesBudget.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: direct two-call/bounded maximum-six-call flows preserve final-state evidence; failures publish nothing; defaults unchanged. Make the manual diagnostic use this provider option rather than a parallel pipeline. Commit with message `feat: reconcile bounded Phi inventories before publication`.

### Task 5: Isolate concise candidate guidance

**Files:** Modify `electron/llm/meetingNotesGuidance.ts`, `electron/llm/meetingNotesReconciliation.ts`, `electron/llm/meetingNotesEditor.ts` and `tests/unit/meetingNotesPrompts.test.ts`.

- [ ] **Step 1: Freeze control prompts and add candidate tests**

Capture default prompt fixtures before changes and assert unchanged output afterward. Candidate prompts require commitment projection, topic-local evidence, conditional/negative outcomes and complete inventory coverage. Retain size ceilings and encoded wire-budget tests. Keyword-presence assertions do not prove semantic quality.

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPrompts.test.ts
```

Expected: missing candidate guidance fails; control fixtures pass.

- [ ] **Step 2: Add one candidate-only semantic block**

Use these exact semantic requirements in a shared candidate block:

- Every accepted future commitment needs an action with accepted owner and explicit deadline in text and structured fields. Discussion or an evidence quote does not replace an action.
- Cite only turns about the same operation or claim. Shared names, dates, project words or negative phrases do not establish support.
- Distinguish a pending conditional commitment from an unmet prerequisite that the source explicitly concludes creates no action. Preserve the condition and final state without inventing a no-action conclusion.
- Preserve material facts, quantities, definitions, reasons, withdrawals, corrections and unresolved questions as well as commitments. User notes and terminology hints are not factual authority.
- The final editor retains inventory items or supplies the source-backed disposition required by Task 3. Read chronological original source to settle changes across parts.

Insert this block only with the experiment option. Keep inventories flat and let the final editor organize the complete meeting. Remove duplicate prose within the candidate branch, not from control prompts. Use no fixture entities or phrases as special cases.

- [ ] **Step 3: Verify and commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPrompts.test.ts tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: default prompt identity unchanged; candidate size/contracts pass. Commit with message `feat: isolate source-first notes guidance`.

### Task 6: Wire reproducible experiments and paired acceptance

**Files:** Modify `scripts/lib/local_intelligence_evaluation.ts`, `tests/unit/localIntelligenceEvaluation.test.ts`, `tests/manual/localIntelligenceEvaluation.test.ts` and the research report. Owner-only raw artifacts live under `.private/local-intelligence-evaluation-788/`.

- [ ] **Step 1: Implement explicit configuration and suite selection**

Version the manifest to validate pipeline, model, partition, collection, settings, schedule and hashes together. Keep historical version-1 manifests readable and strict. Reuse existing ledger/aggregation functions rather than adding another report system.

```ts
export type NotesExperimentConfiguration = {
  configId: 'phi-notes-source-first' | 'gemma-notes-control';
  lane: 'meeting_notes';
  pipelineVariant: 'source_first' | 'compact_control';
  sourceFirstReconciliation: boolean;
  compactWriterContract: true;
  tag: string;
  digest: string;
};
export type NotesScheduledRun = {
  runId: string;
  caseId: string;
  configId: NotesExperimentConfiguration['configId'];
  collection: 'semantic' | 'ordinary_capacity' | 'expected_rejection';
  repetition: number;
  condition: 'cold' | 'warm';
};
```

Validate exact pairs: Phi configuration uses `source_first`/`true`, tag `phi4-mini:3.8b`, digest `78fad5d182a7c33065e153a5f8ba210754207ba9d91973f57dffa7f487363753`; Gemma control uses `compact_control`/`false`, tag `gemma4:12b`, digest `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`. Verify installed identity before inference; aliases/digest substitutions fail.

Pass the selected option into the actual `generateStructuredAnalysis` call. Select the notes lane, explicit partition/collection, then case IDs. Reject unknown/duplicate IDs, empty selection, omitted partition for real candidate runs and schedule mismatch. Explicitly assemble Task 2's new exports. Record response-contract sequence and returned pipeline version so an experiment label cannot disguise the control path.

- [ ] **Step 2: Make dry-run reach the final editor**

Replace the notes dry-run's first-request abort with deterministic, protocol-valid synthetic streaming outputs for inventories and final editor. Exercise real provider schema selection and wire decoding. Stub model inventory/residency, including non-target unload; assert zero real endpoint requests and exact contracts/model/settings for direct and bounded flows.

Inject wrong model/digest, stale source, unknown source label, truncated inventory/editor, dropped point/action, and publication-revision mismatch. Verify failed cases never count as accepted. Default Vitest must perform no inference.

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluation.test.ts tests/unit/localIntelligenceNotesScoring.test.ts tests/unit/localIntelligenceEvaluationCases.test.ts
rtk proxy env RUN_LOCAL_INTELLIGENCE_EVALUATION=1 LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1 LOCAL_INTELLIGENCE_EVALUATION_CONFIG=phi-notes-source-first LOCAL_INTELLIGENCE_EVALUATION_PARTITION=development LOCAL_INTELLIGENCE_EVALUATION_MANIFEST="$PWD/.private/local-intelligence-evaluation-788/evaluator-manifest.json" pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceEvaluation.test.ts
```

Run commands from the implementation worktree. Expected: complete synthetic sequences, no real load/unload/generation. Commit this wiring before real development runs.

- [ ] **Step 3: Preserve attempt denominators across crashes**

Persist a scheduled run start before execution and each physical attempt start before send. Flush each terminal record/artifact before proceeding. Extend the owner-only writer with atomic durable replacement or use an owner-only flushed append ledger. Reconcile orphan starts as interrupted/failed while preserving originals; never silently rerun their IDs or invent missing measurements. Test crash between start/end and timeout before artifact completion.

Record git commit/dirty-diff hash, source revision, corpus/rubric/schedule hashes, pipeline/prompt/schema versions, model digest, Ollama version, seed, temperature, threads, thinking, context/output settings, cache state, leaf/split IDs, calls/physical starts, tokens, termination reason, enqueue/admit/send/first-content/end times and publication status. Use monotonic time for intervals; missing metrics are nullable with a reason.

Freeze ceilings at ten minutes per ordinary run, twenty per long run, six logical calls and twelve physical starts including recovery/preemption. Retain failure, timeout, cancellation and contamination. Contamination stays in the ledger and completion reporting; isolated latency replacements require new linked IDs under a frozen policy, never survivor-only speed ranking.

- [ ] **Step 4: Tune only on development evidence**

Run all twelve inspected cases and development capacity/lifecycle analogues. Permit at most three committed prompt revisions after the initial implementation, each targeting a general failure class and retaining all failed artifacts. Rerun the full semantic development suite and impacted capacity tests. Stop before holdout unless all twelve pass triage and independent source review within this budget.

Before final freeze require development proof of cross-leaf reconciliation, supported ordinary capacity, editor fit, strict failure behavior and completed-writer reuse. Keep Gemma control hashes unchanged. Do not use final holdout outputs to change gold, rubric or settings.

- [ ] **Step 5: Freeze and execute the paired schedule**

Commit the candidate and verify a clean worktree. Freeze every run ID, condition, order and setting before the first held-out request:

| Collection | Per model | Purpose |
| --- | ---: | --- |
| Twelve semantic cases | 12 × 3 = 36 runs | Semantic repeatability, each case at least 2/3 accepted |
| Eight ordinary-capacity cases | 8 × 3 cold + 8 × 3 warm = 48 runs | 24 comparable observations per condition for median/p95 |
| Expected-rejection cases | Three per frozen case | Correct capacity failure and prior-notes preservation |

Both models run the same frozen source/schedule, for **168 supported attempts** plus expected-rejection runs. This is a paired system comparison, not a model-weights-only claim. Alternate model order by case/repetition and retain the exact schedule.

Cold means target absent immediately before measured admission; warm means exact target resident after separately recorded content-free or disjoint-development priming. Never prime using held-out content. Stage-cache reuse is disabled for isolated generation latency and measured separately in Task 7. Record actual resident identity and condition before every attempt, including failures.

Semantic repetitions have predeclared cold/warm assignments and are not pooled into ordinary p95. Report source-size/leaf-count strata alongside the ordinary cohort. If fewer than twenty valid comparable observations remain per condition, that gate is incomplete pending only predeclared replacements. Three repeats of a single semantic result never become three independent quality examples.

Implement `LOCAL_INTELLIGENCE_EVALUATION_SCHEDULE=1` to execute the frozen schedule across both configurations; reject simultaneous single-config overrides. Filtered development runs remain available, but a filtered holdout cannot claim promotion coverage.

```bash
rtk proxy env RUN_LOCAL_INTELLIGENCE_EVALUATION=1 LOCAL_INTELLIGENCE_EVALUATION_SCHEDULE=1 LOCAL_INTELLIGENCE_EVALUATION_PARTITION=held_out LOCAL_INTELLIGENCE_EVALUATION_MANIFEST="$PWD/.private/local-intelligence-evaluation-788/evaluator-manifest.json" LOCAL_INTELLIGENCE_EVALUATION_OUT="$PWD/.private/local-intelligence-evaluation-788/runs" pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceEvaluation.test.ts
```

Use per-run ceilings and durable checkpoints, not the old single 1,230-second Vitest timeout for the whole multi-hour schedule. Resume only unstarted scheduled IDs; interrupted attempts remain counted. No prompt/schema/scorer/gold/fixture/threshold/settings edits after the first held-out request. A necessary fix invalidates promotion from that holdout and requires a fresh one.

- [ ] **Step 6: Human-review and report all outcomes**

Randomize packets hiding model/configuration, order, latency and automated verdict. Review every produced output from the 168 supported attempts and unexpected rejection-case output against original source. Double-review at least 25% of produced outputs plus all disputes/critical errors. Adjudicate every additional factual assertion, keeping both original ratings. One available human reviewer means provisional results and blocked routing promotion.

Report every gate as pass/fail/incomplete, all denominators, per-case and macro/micro quality, unique semantic outputs, scorer confusion matrix, paired differences, cold/warm latency and censored failures, actual tokens/calls, recovery/cache behavior and resources. Assess readability, organization and retained detail, not only extracted commitments. Commit the content-free report with message `docs: report paired Phi notes acceptance evidence`.

### Task 7: Verify downstream, application and recovery behavior

**Files:** Create `tests/manual/localIntelligenceMixedWorkload.test.ts`; modify `electron/meetingAnalysisRuns.ts`, `tests/unit/meetingAnalysisRuns.test.ts` and `tests/unit/dbMeetingAnalysisRuns.test.ts` for candidate identity/activation and publication checks. Reuse synthetic recording/runtime fixtures from `tests/manual/parakeetApplicationWorkflow.test.ts` and existing app-test launch facilities. Extend evaluation contracts/tests and the research report. No production profile or transcript is an integration fixture.

- [ ] **Step 1: Build and verify a disposable app entry**

Launch with an absolute temporary userData directory, separate DB, synthetic sources and isolated settings. Assert app profile/DB paths before mutation. An opt-in test entry passes the same source-first provider option; reject candidate test activation in a production profile. Other workloads retain production model selection so mixed-model residency and switching really occur. Do not enable Phi globally to cheapen the workload.

Use `createMeetingAnalysisRunCoordinator` in `electron/meetingAnalysisRuns.ts` and its `generateAndPublishMeetingNotes` entry for notes-run integration. Its provider dependency is the candidate injection boundary; use the real provider with the explicit candidate option, not a mock that returns accepted notes. Verify the actual `publishMeetingNotesIfCurrent` boundary in `electron/db.ts`. Extend coordinator run/cache identity and associated tests where necessary to carry the candidate policy. Recheck recording and Ask Pluto IPC bindings during implementation and encode those actual app commands in the harness before executing it. Reuse available fixtures; the native transcription test alone is not evidence that renderer, IPC, scheduler and publication executed. Add a dry mode validating paths, scenario inventory and activation without capture/inference.

```bash
rtk proxy env RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD=1 LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1 pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceMixedWorkload.test.ts
```

Expected: profile checks pass with no capture or inference. Production paths, missing runtime, absent activation or unavailable required telemetry prevent acceptance execution.

- [ ] **Step 2: Implement downstream generated-notes track B**

Do not assume a completed track B exists. Add an adapter that seeds accepted generated notes into the disposable app's real commitment/project/dreaming consumer path, using unchanged downstream models. Start from `packageEntityNotes` in `electron/dreaming/packageEntityNotes.ts` and `createIdleDreamingCoordinator` in `electron/dreaming/idleDreamingCoordinator.ts`; invoke the coordinator's `triggerNow`/`attemptIdleRun` entries against the disposable database and inspect persisted proposals. Exercise multiple meetings with a correction, withdrawal, conditional task, same-name unrelated project, legitimate no-change outcome and legitimate new proposal.

Trace every resulting commitment/proposal through notes provenance to original transcript. Verify owner/date/modality, no withdrawn work resurrection, no invented causal/project link, correct no-change, and legitimate proposal recall. A quote from generated notes is insufficient. Run the same consumers with fixed human-reviewed notes to distinguish upstream omission from downstream failure. Neither track mutates production data.

- [ ] **Step 3: Compare recording control with sustained mixed load**

Run a settled 30-minute transcription-only control and a matched 30-minute mixed workload with identical synthetic audio/markers and timing instrumentation. Record hardware/power/workload, residency and starting thermal/pressure/swap baseline. Repeat contaminated comparisons under separate IDs, preserving originals. Do not require zero pre-existing swap.

Mixed workload: recording with permitted background notes; repeated cached navigation; Ask Pluto every fifteen seconds for two minutes; four completed fixture meetings; new recording during idle dreaming; then stop foreground traffic and verify notes finish or fail explicitly within the frozen ceiling. Observe preemption, compatible completed-part reuse, queue progress and publication identity.

Sample once per second: process RSS, Ollama residency, pressure, swap occupancy/paging, thermal state, queue transitions, audio markers/chunks and live-transcript delay. Missing pressure/thermal/capture/timing evidence is incomplete acceptance. Do not add overlapping RSS/residency/shared memory as independent allocations.

Pass: zero lost/duplicated markers or corrupted chunks; at most 10% p95 live-transcript delay regression versus control; cached-navigation p95 actionable content within 500 ms; Ask Pluto during notes p95 first useful content within five seconds; lower-priority work yields within two seconds; no indefinite notes starvation after foreground traffic ends. Collect at least twenty comparable samples per responsiveness p95, using separately recorded additional responsiveness trials if needed.

Resource gates: no serious/critical thermal state over thirty seconds, no sustained critical pressure, at most 512 MiB swap-occupancy growth from settled baseline, and paging inspection. Critical pressure, recording integrity failure or privacy breach stops new inference admission immediately and terminates the evaluation safely. Stop optional work after thirty seconds serious thermal state. Preserve diagnostics; do not automatically resume.

- [ ] **Step 4: Inject interruptions and verify publication**

Run labeled source-edit-during-generation, runtime crash, app restart after persisted start, sleep/wake, user cancellation and repeated-preemption scenarios in the disposable profile. Keep them separate from isolated latency ranking. Seed valid prior notes before each failure.

Assert no stale/partial replacement or false ready notification; source revision and candidate identity agree at publication; reuse only compatible completed stages; durable retry guards survive restart; timeout/cancellation/preemption remain distinct; no duplicate publication/downstream action; a successful explicit retry converges after fault removal. Inspect persisted state and actual app behavior, not only mocks.

- [ ] **Step 5: Execute integration and required implementation checks**

```bash
rtk proxy env RUN_LOCAL_INTELLIGENCE_MIXED_WORKLOAD=1 LOCAL_INTELLIGENCE_EVALUATION_MANIFEST="$PWD/.private/local-intelligence-evaluation-788/evaluator-manifest.json" LOCAL_INTELLIGENCE_EVALUATION_OUT="$PWD/.private/local-intelligence-evaluation-788/integration" pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceMixedWorkload.test.ts
rtk pnpm rebuild better-sqlite3
rtk pnpm exec vitest run
rtk pnpm run ensure:sqlite-abi
rtk pnpm exec tsc --noEmit
rtk pnpm run lint
rtk pnpm run changelog:check
rtk git diff --check
rtk git diff --check origin/master...HEAD
```

Use explicit per-scenario timeouts/checkpoints for long runs. Restore Electron SQLite ABI even if Node/Vitest checks fail before returning to app work. Default tests must not launch opt-in capture/inference. Fix failures introduced here and distinguish pre-existing failures in reporting.

- [ ] **Step 6: Deliver evidence before a separate routing decision**

Include the changelog fragment with implementation before merge, describing actual experiment scope and verification. Update #788/#695 and the research report with every gate and known capacity limit. Commit integration/report files with message `test: establish Phi notes application acceptance gates`.

Experiment-disabled hardening can merge after code review and checks; that does not promote Phi. Any failed/incomplete quality, capacity, human, downstream or runtime gate blocks routing. A separate notes-only routing PR requires preserved explicit user model choices, defined exact-model-unavailable behavior, incompatible-cache invalidation, preserved prior notes, selected-meeting canary and one-step rollback to Gemma. Do not silently download models, rewrite existing notes, or choose a larger fallback to hide candidate failure.

## Required coverage and delivery checkpoints

| Boundary | Required evidence |
| --- | --- |
| Projection → scoring | Valid summary/point/question; owner mapping; original-span association; additional/contradictory assertion review |
| Leaf → inventory | Canonical indexes/revision; scoped omission checks; reject cross-leaf citations and in-leaf omissions |
| Inventories → editor | Unique IDs; all-item coverage; chronological cancellation/correction/renewal; supported dispositions |
| Stage → provider | Cache admission/invalidation; no partial cache; wire fit; cancellation; exact model; logical/physical ceilings |
| Capacity → acceptance | Direct, multiple leaves, recovery, dense output, aggregate overflow, ordinary bands, explicit rejection partition |
| Config → harness | Actual candidate activation; full corpus; dry transport reaches editor; durable crash denominator |
| Evaluation → promotion | Paired frozen systems; 24 ordinary samples per condition/model; all produced claims reviewed; missing evidence blocks |
| App → downstream | Disposable activation; recording control; responsiveness; restart/sleep/preemption; prior notes preserved; original-source traceability |

Review implementation in three groups: scorer/corpus/harness contracts; candidate pipeline/guidance; empirical evaluation/integration. Scoring fixes precede tuning; capacity development precedes final freeze; semantic/human gates precede routing. Do not introduce extra architecture merely to parallelize these groups.

## Engineering review disposition

| Finding | Resolution |
| --- | --- |
| Scorer skips summaries and assumes inline evidence | Task 1 maps actual paths and resolves canonical provenance |
| Whole-source parser rejects valid leaves | Task 3 adds admitted source scope without renumbering |
| Leaf editors cannot settle global state | Task 4 uses one mandatory full-source editor after all writers |
| Helper bypasses stage/cache safeguards and underbudgets editor | Task 4 reuses stage execution and reserves encoded envelopes |
| Experiment label does not activate route; dry-run stops too soon | Task 6 validates activation, assembly and complete synthetic transport |
| Precision/control stability missing | Frozen atomic precision/paired recall gates; Task 5 isolates prompts |
| Source scale unmeasured; p95 sample count insufficient | Task 2 capacity fixtures; Task 6 schedules 24 runs per ordinary condition |
| Integration lacks an executable evidence path | Task 7 specifies isolated activation, downstream adapter, control workloads and recovery |

The review findings are addressed in these implementation requirements. All implementation and empirical acceptance remain unchecked; this revision does not certify code correctness, supported capacity, model quality or production readiness.
