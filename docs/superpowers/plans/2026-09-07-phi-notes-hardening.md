# Phi Meeting Notes Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `phi4-mini:3.8b` evidence-complete enough for Pluto meeting notes on the 16 GB reference Mac without weakening trust checks or changing production routing before it passes fresh held-out, human, and integrated gates.

**Architecture:** Replace the Phi candidate's section-writing first pass with the existing source-first reconciliation contract: one flat, source-grounded inventory of facts, actions, decisions, and questions, followed by the existing final editor with actions and decisions protected as inherited commitments. Upgrade the evaluator to inspect the structured `AnalysisDocumentV3` projection and its evidence fields so omitted owners/actions and cross-topic citations cannot pass because the words occur elsewhere in serialized JSON. Keep the new route behind an explicit evaluation option until a separate routing PR is authorized by frozen acceptance evidence.

**Tech Stack:** Electron, TypeScript, Ollama structured JSON, Vitest, Pluto's meeting-notes reconciliation/editor/grounding pipeline, opt-in manual evaluation harness.

**Tracking:** [#788](https://github.com/metagrover/pluto/issues/788), with integrated resource follow-up under [#695](https://github.com/metagrover/pluto/issues/695).

---

## Scope and frozen decision boundary

This plan focuses only on Phi meeting-note generation. It does not select a model for cross-meeting comparison, project synthesis, or dreaming. Gemma remains the production notes control throughout Tasks 1–6.

The twelve cases exercised on September 7 are now development/regression evidence because their failures have been inspected. They cannot be reused as held-out promotion evidence. A new twelve-case corpus is frozen before candidate outputs are generated.

Promotion requires all of the following:

- zero unsupported critical identity, owner, commitment, deadline, condition, correction, withdrawal, or evidence-association claims;
- 100% critical-fact recall and at least 95% action/decision recall across the new held-out corpus;
- at least 95% accepted completion, with every case accepted at least twice in three repetitions;
- median blinded human usefulness at least 4/5 and no critical case below 3/5;
- no wrong-model, residency, unsafe-truncation, stale-source, privacy, or publication-provenance failure;
- ordinary-notes median at most 120 seconds and empirical p95 at most 240 seconds when the comparable cell contains at least twenty runs;
- the downstream and 30-minute mixed-workload gates in Task 7.

Do not relax these thresholds after seeing outputs. Repeated identical generations count as repeated runs, not independent semantic evidence.

## File responsibility map

- `tests/manual/fixtures/localIntelligenceEvaluationCases.ts`: shared case/gold types and the already-inspected development corpus.
- `tests/manual/fixtures/localIntelligencePhiNotesHeldOut.ts`: new sealed Phi notes corpus; no production imports.
- `tests/manual/fixtures/localIntelligenceNotesScoring.ts`: structured notes-only scorer and human-review projection.
- `tests/manual/localIntelligenceEvaluation.test.ts`: opt-in runner, artifact schema, model/prompt identity, and aggregate output.
- `tests/unit/localIntelligenceNotesScoring.test.ts`: false-pass regression coverage for the scorer.
- `tests/unit/localIntelligenceEvaluationCases.test.ts`: partition, evidence, hash, and failure-mode coverage.
- `electron/llm/meetingNotesGuidance.ts`: short shared semantic rules for commitments, unmet conditions, and topic-local evidence.
- `electron/llm/meetingNotesReconciliation.ts`: source-first prompt/parser already suited to the first pass.
- `electron/llm/meetingNotesSchema.ts`: structured Ollama schema for the reconciliation response.
- `electron/llm/meetingNotesTypes.ts`: explicit experimental pipeline option and reconciliation response contract.
- `electron/llm/meetingNotesPipeline.ts`: two-pass source-first candidate route.
- `electron/llm/unifiedProvider.ts` and `electron/llm/provider.ts`: carry the evaluation-only option to the pipeline.
- `tests/unit/meetingNotesPrompts.test.ts`, `tests/unit/meetingNotesReconciliation.test.ts`, `tests/unit/meetingNotesPipeline.test.ts`, and `tests/unit/meetingNotesProviderRouting.test.ts`: production-contract regression coverage.
- `tests/manual/meetingNotesReconciliationAcceptance.test.ts`: real-provider source-first diagnostic, retained as a development test.
- `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md`: content-free result addendum.
- `docs/changelog/entries/2026-09-07-788-phi-notes-hardening.md`: shipped pipeline/harness explanation; no routing claim.

### Task 1: Make automated notes scoring structure-aware

**Files:**
- Create: `tests/manual/fixtures/localIntelligenceNotesScoring.ts`
- Modify: `tests/manual/fixtures/localIntelligenceEvaluationCases.ts:5-25,1180-1301`
- Create: `tests/unit/localIntelligenceNotesScoring.test.ts`
- Modify: `tests/manual/localIntelligenceEvaluation.test.ts:15-25,539-555`

- [ ] **Step 1: Write failing regressions for the six Phi automated false passes**

Construct minimal `AnalysisDocumentV3` values proving that global string presence is insufficient:

```ts
it('rejects an action that exists only inside decision evidence', () => {
  const result = scoreNotesGoldOutput(caseWithLenaCommitment, {
    ...emptyAnalysis,
    topics: [{
      ...emptyTopic,
      decisions: [{
        text: 'The rollout sequence was approved.',
        evidence: 'Lena will send the rollout note by November 6.',
      }],
    }],
  });
  expect(result).toMatchObject({ passed: false });
  expect(result.claimResults[0]).toMatchObject({
    projectionMatched: false,
    ownerMatched: false,
  });
});

it('rejects a decision supported by an unrelated topic boundary', () => {
  const result = scoreNotesGoldOutput(caseWithResearchAccessDecision, {
    ...analysisWithResearchAccessDecision,
    topics: [{
      ...emptyTopic,
      decisions: [{
        text: 'Research receives read-only access.',
        evidence: 'The public dashboard was not approved.',
      }],
    }],
  });
  expect(result.claimResults[0]).toMatchObject({
    projectionMatched: true,
    evidenceMatched: false,
  });
  expect(result.passed).toBe(false);
});
```

Cover the observed families: Lena owner/action, Nia and Luis actions, Ravi owner/action, the public-dashboard evidence crossover, and the explicit unmet-compliance/no-action conclusion.

- [ ] **Step 2: Run the tests and verify the old flattened scorer fails**

Run:

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceNotesScoring.test.ts
```

Expected: FAIL because `scoreNotesGoldOutput` and projection-level result fields do not exist.

- [ ] **Step 3: Add projection expectations to notes gold claims**

Extend `GoldClaim` with an optional notes-only contract:

```ts
export type NotesProjectionExpectation = {
  kind: 'point' | 'action' | 'decision' | 'question';
  requiredTextTerms: string[];
  requiredEvidenceTerms: string[];
  forbiddenEvidenceTerms?: string[];
  owner?: string;
  due?: string;
};

export type GoldClaim = {
  id: string;
  evidence: Array<{ sourceId: string; excerpt: string }>;
  requiredTerms: string[];
  critical: boolean;
  modality: 'fact' | 'tentative' | 'conditional' | 'committed' | 'withdrawn';
  owner?: string;
  date?: string;
  notesProjection?: NotesProjectionExpectation;
};
```

Every meeting-notes gold claim must declare `notesProjection`. Non-notes lanes retain `scoreGoldOutput` unchanged.

- [ ] **Step 4: Implement a structured scorer over final user-visible projections**

Create `scoreNotesGoldOutput(candidate, analysis)` that flattens `topics[].key_points`, `action_items`, `decisions`, and `open_questions` into typed candidates. A required claim passes only when one candidate item contains all required text alternatives, has the required structured owner/due fields, and has evidence containing every required evidence term and none of the forbidden evidence terms.

```ts
export type NotesClaimScore = {
  id: string;
  critical: boolean;
  projectionMatched: boolean;
  ownerMatched: boolean;
  dueMatched: boolean;
  evidenceMatched: boolean;
  passed: boolean;
};

export const scoreNotesGoldOutput = (
  candidate: LocalIntelligenceNotesCase,
  analysis: AnalysisDocumentV3,
) => {
  const projected = projectAnalysisItems(analysis);
  const claimResults = candidate.gold.requiredClaims.map((claim) =>
    scoreNotesClaim(claim, projected),
  );
  const visibleText = JSON.stringify({
    overview: analysis.overview,
    topics: analysis.topics,
  });
  const forbiddenMatches = scoreForbiddenClaims(
    visibleText,
    candidate.gold.forbiddenClaims,
  );
  return {
    claimResults,
    criticalPassed: claimResults
      .filter((claim) => claim.critical)
      .every((claim) => claim.passed),
    forbiddenMatches,
    passed:
      claimResults.every((claim) => claim.passed) &&
      forbiddenMatches.length === 0,
  };
};
```

Do not use `all_action_items` or `all_decisions` as a second chance: they are derived duplicates. Score the topic projections users actually read.

- [ ] **Step 5: Switch only the meeting-notes lane to structured scoring**

In the manual runner, replace:

```ts
const goldScore = scoreGoldOutput(candidate, JSON.stringify(analysis));
```

with:

```ts
const goldScore = scoreNotesGoldOutput(candidate, analysis);
```

Keep `automatedTriageAccepted` and `reviewStatus: 'pending_human_review'`; a better scorer still does not become the human acceptance authority.

- [ ] **Step 6: Run focused verification and commit**

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceNotesScoring.test.ts tests/unit/localIntelligenceEvaluationCases.test.ts
rtk git add tests/manual/fixtures/localIntelligenceEvaluationCases.ts tests/manual/fixtures/localIntelligenceNotesScoring.ts tests/manual/localIntelligenceEvaluation.test.ts tests/unit/localIntelligenceNotesScoring.test.ts
rtk git commit -m "test: score notes evidence by structured projection"
```

Expected: all focused tests PASS, including all six false-pass regressions.

### Task 2: Seal a genuinely fresh Phi held-out corpus

**Files:**
- Create: `tests/manual/fixtures/localIntelligencePhiNotesHeldOut.ts`
- Modify: `tests/manual/fixtures/localIntelligenceEvaluationCases.ts`
- Modify: `tests/unit/localIntelligenceEvaluationCases.test.ts`

- [ ] **Step 1: Relabel the inspected September 7 notes cases as development cases**

Change the twelve evaluated notes cases from `partition: 'held_out'` to `partition: 'development'`. Preserve their IDs, transcript text, gold labels, and failure IDs exactly so historical artifacts remain interpretable.

- [ ] **Step 2: Write partition tests before adding new cases**

```ts
it('keeps inspected notes cases out of promotion holdout', () => {
  expect(
    localIntelligenceEvaluationCases
      .filter((candidate) => candidate.lane === 'meeting_notes')
      .filter((candidate) => candidate.id.startsWith('notes-'))
      .filter((candidate) => inspectedSeptember7Ids.has(candidate.id))
      .every((candidate) => candidate.partition === 'development'),
  ).toBe(true);
});

it('freezes twelve unseen Phi notes cases with the required profile mix', () => {
  const heldOut = phiNotesHeldOutCases;
  expect(heldOut).toHaveLength(12);
  expect(countBy(heldOut, 'syntheticProfile')).toEqual({
    short: 3,
    ordinary: 4,
    long_dense: 3,
    adversarial_sparse: 2,
  });
  expect(new Set(heldOut.map((candidate) => candidate.id)).size).toBe(12);
});
```

- [ ] **Step 3: Add twelve new cases without reusing old names or wording**

Encode this exact coverage matrix in `localIntelligencePhiNotesHeldOut.ts`:

| Profile | Case contract |
| --- | --- |
| short | requester/recipient decoy; a different speaker accepts ownership and a deadline |
| short | an initial due date is explicitly corrected; only the corrected date may survive |
| short | a proposal is explicitly declined; preserve the negative decision without inventing an action |
| ordinary | the only accepted owner/date commitment occurs in the final turn |
| ordinary | a conditional task is discussed, its prerequisite remains unmet, and the source explicitly concludes no action |
| ordinary | an owner withdraws one task, retains a second task, and gives a reason |
| ordinary | two unrelated topics share a project word and date; evidence must remain topic-local |
| long/dense | three owners, two deadlines, one handoff, and one superseded date across beginning/middle/end |
| long/dense | a settled decision and action are separated by unrelated negative discussion using overlapping vocabulary |
| long/dense | one conditional action becomes committed while another remains conditional and a third is cancelled |
| adversarial/sparse | repeated names and dates appear in decoys; only one segment contains an accepted commitment |
| adversarial/sparse | an unmet approval condition and explicit no-action conclusion are separated by unrelated material |

Each critical action case must set `notesProjection.kind: 'action'`, exact `owner` and `due` when present, and evidence terms unique to the supporting source. Boundary cases must set `forbiddenEvidenceTerms` from the unrelated segment.

- [ ] **Step 4: Freeze corpus and rubric hashes before any real run**

Add a unit test that canonicalizes each object, calculates SHA-256, and compares it with a separately reviewed literal constant named `FROZEN_PHI_NOTES_CORPUS_SHA256` or `FROZEN_PHI_NOTES_RUBRIC_SHA256`. Obtain the initial values with the same exported `sha(canonicalJson(...))` helper, paste the resulting 64-character digests into the constants, rerun the test, and commit them before the first model request. The test must compare literals and must not update snapshots automatically.

- [ ] **Step 5: Verify evidence resolution, partition isolation, and commit**

```bash
rtk pnpm exec vitest run tests/unit/localIntelligenceEvaluationCases.test.ts tests/unit/localIntelligenceNotesScoring.test.ts
rtk git add tests/manual/fixtures/localIntelligenceEvaluationCases.ts tests/manual/fixtures/localIntelligencePhiNotesHeldOut.ts tests/unit/localIntelligenceEvaluationCases.test.ts
rtk git commit -m "test: freeze fresh Phi notes holdout"
```

Expected: all cases have resolvable evidence, all note claims have structured projection contracts, the profile mix is exact, and development/held-out IDs do not overlap.

### Task 3: Add the source-first reconciliation response contract

**Files:**
- Modify: `electron/llm/meetingNotesTypes.ts:56-112`
- Modify: `electron/llm/meetingNotesSchema.ts:25-184`
- Modify: `electron/llm/provider.ts:83-132`
- Modify: `electron/llm/unifiedProvider.ts:520-590`
- Modify: `tests/unit/meetingNotesProviderRouting.test.ts`
- Modify: `tests/unit/meetingNotesReconciliation.test.ts`

- [ ] **Step 1: Write failing schema and wire-routing tests**

Assert that a reconciliation request uses the four-array schema and that the explicit experiment option reaches `generateMeetingNotes` without affecting default calls:

```ts
expect(buildNotesResponseSchema('reconciliation', ['S0', 'S1'])).toEqual(
  expect.objectContaining({
    required: ['facts', 'actions', 'decisions', 'questions'],
    additionalProperties: false,
  }),
);

expect(generateMeetingNotes).toHaveBeenCalledWith(
  expect.objectContaining({ sourceFirstReconciliation: true }),
);
```

- [ ] **Step 2: Run the tests and confirm the new contract is rejected**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: FAIL because the option and response contract do not exist.

- [ ] **Step 3: Add the explicit experimental types**

```ts
export type NotesResponseContract =
  | 'draft'
  | 'compact_draft'
  | 'reconciliation'
  | 'audit'
  | 'editor';

export type GenerateMeetingNotesInput = {
  // existing fields remain unchanged
  /** Evaluation-only source-first candidate. Product callers retain false. */
  sourceFirstReconciliation?: boolean;
};
```

Add the same documented optional field to `LLMProvider.generateStructuredAnalysis` and `UnifiedLLMProvider.generateStructuredAnalysis`. Pass it through unchanged. Do not read the model name inside the pipeline and do not enable the option from settings.

- [ ] **Step 4: Build the exact Ollama reconciliation schema**

In `buildNotesResponseSchema`, add a `reconciliation` branch matching `parseReconciledSource`:

```ts
if (contract === 'reconciliation') {
  const supported = (properties: Record<string, Schema>) =>
    object({
      text: { type: 'string', minLength: 1, maxLength: 12_000 },
      sources,
      ...properties,
    });
  return object({
    facts: array(supported({})),
    actions: array(supported({ owner: nullableString, due: nullableString })),
    decisions: array(supported({ owner: nullableString })),
    questions: array(supported({})),
  });
}
```

Ensure the required keys produced by `object()` match the parser. IDs remain application-assigned and must not be requested from the model.

- [ ] **Step 5: Verify and commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingNotesTransport.test.ts
rtk git add electron/llm/meetingNotesTypes.ts electron/llm/meetingNotesSchema.ts electron/llm/provider.ts electron/llm/unifiedProvider.ts tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingNotesReconciliation.test.ts
rtk git commit -m "feat: add source-first notes response contract"
```

### Task 4: Wire a two-pass source-first Phi candidate without changing defaults

**Files:**
- Modify: `electron/llm/meetingNotesPipeline.ts:1381-1580,1581-1734`
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `tests/manual/meetingNotesReconciliationAcceptance.test.ts`

- [ ] **Step 1: Write failing pipeline-order and preservation tests**

Add a direct-fit test where the first generated response is a reconciliation and the second is an edited document. Assert:

```ts
expect(requests.map((request) => request.responseContract)).toEqual([
  'reconciliation',
  'editor',
]);
expect(requests[1]?.prompt).toContain('BEGIN INHERITED COMMITMENTS');
expect(requests[1]?.prompt).toContain('Lena');
expect(result.all_action_items).toEqual([
  expect.objectContaining({ assignee: 'Lena', due: 'November 6' }),
]);
```

Add negative tests proving that the editor cannot silently omit or mutate an inherited action, that unrelated evidence cannot replace its source span, and that default compact writer/editor calls still request `compact_draft` then `editor`.

- [ ] **Step 2: Run the focused test and verify the candidate route does not exist**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts -t "source-first"
```

Expected: FAIL because `sourceFirstReconciliation` is not handled.

- [ ] **Step 3: Add a source-first draft helper**

The helper must use existing parsing and guardrails rather than inventing a parallel trust path:

```ts
const writeSourceFirstDraft = async (
  input: GenerateMeetingNotesInput,
  sourceText: string,
  evidenceSpans: SourceSpan[],
  idPrefix = 'document',
): Promise<{ draft: NotesDraft; inherited: NotesItem[] }> => {
  const raw = await input.generate({
    task: 'notesWriter',
    responseContract: 'reconciliation',
    prompt: buildSourceReconciliationPrompt(sourceText),
    outputTokens: COMPACT_WRITER_OUTPUT_TOKENS,
    contextTokens: input.contextTokens,
    signal: input.signal,
    sourceSpans: evidenceSpans,
  });
  const reconciled = parseReconciledSource(raw, input.source);
  const draft = remapDraftIds(reconciliationDraft(reconciled), idPrefix);
  return {
    draft,
    inherited: draft.sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind === 'action' || item.kind === 'decision'),
  };
};
```

Import `buildSourceReconciliationPrompt`, `parseReconciledSource`, and `reconciliationDraft` from `meetingNotesReconciliation.ts`.

- [ ] **Step 4: Use the helper only when explicitly requested**

In the direct compact path, select `{draft, inherited}` from `writeSourceFirstDraft` when `sourceFirstReconciliation === true`; otherwise retain the current writer behavior and `inherited: []`. Pass the inherited items into `auditDraftWithinOptionalBudget` so `buildNotesEditorPrompt` emits the existing preservation/disposition contract.

For the source-first experiment, fail closed if reconciliation parsing/guardrails fail. Do not apply writer-draft recovery to an unknown or partial reconciliation. If the editor hits an already-allowed optional-review fallback, publish only through the existing deterministic acceptance path and record a source-first-specific warning so the evaluation denominator exposes it.

- [ ] **Step 5: Apply the same contract to bounded leaves**

When capacity planning selects `runBoundedCompactNotes`, build the fixed envelope from `buildSourceReconciliationPrompt` instead of `buildCompactNotesWriterPrompt` for the source-first variant. Each leaf must call `writeSourceFirstDraft(input, sourceText, evidenceSpans, idPrefix)`, retain its remapped inherited actions/decisions, and pass those items into that leaf's editor. Add a multi-leaf test proving IDs remain unique and an action in the second leaf cannot be silently omitted.

- [ ] **Step 6: Preserve limits, cache identity, and metadata**

Include `sourceFirstReconciliation` in prompt/pipeline versioning and stage-cache identity. The route must remain subject to the existing call limit, context fit calculation, cancellation, source revision, and Ollama residency admission. Record a distinct pipeline version such as `notes-v30-source-first`; do not label it as the default `notes-v30` path.

- [ ] **Step 7: Verify both candidate and control paths, then commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesStageCache.test.ts tests/unit/meetingNotesCancellationContext.test.ts
rtk git add electron/llm/meetingNotesPipeline.ts tests/unit/meetingNotesPipeline.test.ts tests/manual/meetingNotesReconciliationAcceptance.test.ts
rtk git commit -m "feat: add source-first Phi notes experiment"
```

### Task 5: Make the prompt contract explicit and small-model-friendly

**Files:**
- Modify: `electron/llm/meetingNotesGuidance.ts:1-16`
- Modify: `electron/llm/meetingNotesReconciliation.ts:33-43`
- Modify: `electron/llm/meetingNotesEditor.ts:48-96`
- Modify: `electron/llm/meetingNotesPrompts.ts:132-204`
- Modify: `tests/unit/meetingNotesPrompts.test.ts`

- [ ] **Step 1: Add failing prompt-contract tests for the observed failures**

```ts
for (const prompt of [
  buildSourceReconciliationPrompt(''),
  buildNotesEditorPrompt({ ...input, compactDraft: true }),
]) {
  expect(prompt).toContain('one action item');
  expect(prompt).toContain('owner and due fields');
  expect(prompt).toContain('same operation or decision');
  expect(prompt).toContain('prerequisite was not met');
  expect(prompt).toContain('no action was assigned');
}
```

Also retain the existing shared-guidance word ceiling. The new rules must replace redundant prose rather than making every prompt longer without bound.

- [ ] **Step 2: Run the prompt tests and observe the missing contract language**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPrompts.test.ts
```

Expected: FAIL on the four new semantic requirements.

- [ ] **Step 3: Add one shared coverage block**

Export and insert this block in the reconciliation and final editor prompts:

```ts
export const notesEvidenceCompletenessGuidance = [
  'BEGIN EVIDENCE COMPLETENESS GUIDANCE',
  'For every accepted future commitment, emit one action item. Put the accepted owner and explicit deadline in both the action text and owner and due fields; a point, overview, decision rationale or evidence quote does not count as the action.',
  'An item may cite only turns about the same operation or decision. Do not use an unrelated sentence merely because it repeats a person, date, project word or negative phrase.',
  'When a prerequisite was not met, do not emit the conditional task as an action. Preserve the prerequisite, its unmet state, and an explicit source-backed conclusion that no action was assigned.',
  'Before returning, check each source turn for a commitment, correction, withdrawal, condition or final-state boundary and verify that its current state appears in the correct structured item.',
  'END EVIDENCE COMPLETENESS GUIDANCE',
].join('\n');
```

Remove semantically duplicate sentences from the compact writer/editor/audit prompts so the shared content policy remains within its current tested ceiling. Keep the owner/requester/recipient, correction, withdrawal, and unaccepted-offer rules unchanged.

- [ ] **Step 4: Strengthen the source-first instruction without fixture vocabulary**

Immediately before the reconciliation schema, add:

```ts
'Work source-first, not summary-first. Classify each current-state claim once. Keep unrelated topics in separate entries even when they share names, dates or vocabulary.',
```

Do not mention Lena, Ravi, Noor, dashboards, compliance, or any held-out entity/phrase in production prompts.

- [ ] **Step 5: Verify prompt size and behavior, then commit**

```bash
rtk pnpm exec vitest run tests/unit/meetingNotesPrompts.test.ts tests/unit/meetingNotesReconciliation.test.ts tests/unit/meetingNotesPipeline.test.ts
rtk git add electron/llm/meetingNotesGuidance.ts electron/llm/meetingNotesReconciliation.ts electron/llm/meetingNotesEditor.ts electron/llm/meetingNotesPrompts.ts tests/unit/meetingNotesPrompts.test.ts
rtk git commit -m "fix: make notes completeness contract explicit"
```

### Task 6: Run the bounded Phi-only development and held-out evaluation

**Files:**
- Modify: `tests/manual/localIntelligenceEvaluation.test.ts`
- Create privately: `.private/local-intelligence-evaluation-788/evaluator-manifest.json`
- Create privately: `.private/local-intelligence-evaluation-788/runs/*.private.json`
- Modify after execution: `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md`

- [ ] **Step 1: Record pipeline identity in every artifact**

Add `pipelineVariant`, prompt version, corpus hash, rubric hash, source revision, dirty-diff hash, exact model digest, Ollama version, seed, structured-thinking flag, context/output settings, and physical wire starts to the artifact. Assert the selected model is exactly:

```text
phi4-mini:3.8b
78fad5d182a7c33065e153a5f8ba210754207ba9d91973f57dffa7f487363753
```

Add `LOCAL_INTELLIGENCE_EVALUATION_PARTITION` selection so the sealed run cannot accidentally include development cases:

```ts
const requestedPartition = process.env.LOCAL_INTELLIGENCE_EVALUATION_PARTITION;
if (
  requestedPartition !== undefined &&
  requestedPartition !== 'development' &&
  requestedPartition !== 'held_out'
) {
  throw new Error('evaluation_partition_unknown');
}
const partitioned = requestedPartition
  ? localIntelligenceEvaluationCases.filter(
      (candidate) => candidate.partition === requestedPartition,
    )
  : localIntelligenceEvaluationCases;
```

Apply the existing explicit case-ID filter to `partitioned`, and record the selected partition in the artifact. Artifacts remain owner-only and ignored. Default Vitest execution must perform no inference.

- [ ] **Step 2: Run dry-wire and deliberate-failure checks**

```bash
rtk proxy env RUN_LOCAL_INTELLIGENCE_EVALUATION=1 LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN=1 LOCAL_INTELLIGENCE_EVALUATION_MANIFEST=/Users/metagrover/Desktop/pluto/.worktrees/788-phi-notes-plan/.private/local-intelligence-evaluation-788/evaluator-manifest.json pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceEvaluation.test.ts
```

Expected: PASS with reconciliation then editor requests, exact Phi model identity, zero endpoint inference, and content-free unloads recorded separately. Wrong-model, changed-source, truncated, and structurally incomplete synthetic outputs must be rejected.

- [ ] **Step 3: Use the inspected twelve cases only as a development gate**

Run one repetition of the current twelve development cases on the source-first route. Compare against the archived 27/36 baseline by failure family, not by pretending the old runs share the new scorer. Allow at most three committed prompt revisions. Each revision must state the general failure class, change the production prompt without fixture entities, rerun all twelve development cases, and retain every failed run.

Development exit requirement: all twelve cases pass the structured automated scorer and independent source review in one frozen revision. If this is not achieved within three revisions, publish the remaining failures and stop before held-out inference.

- [ ] **Step 4: Freeze source and run the new held-out corpus exactly once**

After the development gate passes, commit the prompt/pipeline revision and verify a clean worktree. Run all twelve new cases three times in a counterbalanced cold/warm order. Do not edit prompts, schemas, scorer, gold labels, thresholds, or fixtures after the first held-out request starts.

Run each repetition with:

```bash
rtk proxy env RUN_LOCAL_INTELLIGENCE_EVALUATION=1 LOCAL_INTELLIGENCE_EVALUATION_CONFIG=phi-notes-source-first LOCAL_INTELLIGENCE_EVALUATION_PARTITION=held_out LOCAL_INTELLIGENCE_EVALUATION_MANIFEST=/Users/metagrover/Desktop/pluto/.worktrees/788-phi-notes-plan/.private/local-intelligence-evaluation-788/evaluator-manifest.json LOCAL_INTELLIGENCE_EVALUATION_OUT=/Users/metagrover/Desktop/pluto/.worktrees/788-phi-notes-plan/.private/local-intelligence-evaluation-788/runs pnpm exec vitest run --config vitest.manual.config.ts tests/manual/localIntelligenceEvaluation.test.ts
```

Retain failures, timeouts, cancellations, and contaminated runs in the denominator.

- [ ] **Step 5: Conduct blinded human review**

Create a randomized content-only packet hiding model, run order, latency, and automated verdict. Review all 36 outputs against source for atomic precision, critical recall, action/decision recall, owner/date accuracy, modality, evidence association, and usefulness 1–5. Double-review nine randomly selected outputs plus every disputed or critical-error output. Resolve disagreements against source and preserve both original ratings.

If only one human reviewer is available, label the result provisional and block routing promotion even when numerical gates pass.

- [ ] **Step 6: Publish content-free results and commit**

Report per-case and macro denominators, structured-triage confusion matrix against human review, latency by profile, physical starts, fallback/warning frequency, residency events, resource snapshots, and every gate failure. Clearly distinguish development tuning from held-out evidence.

```bash
rtk git add docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md
rtk git commit -m "docs: report Phi notes hardening evaluation"
```

### Task 7: Run downstream and integrated gates before any routing PR

**Files:**
- Create: `tests/manual/localIntelligenceMixedWorkload.test.ts`
- Modify: `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md`
- Create only after the change ships: `docs/changelog/entries/2026-09-07-788-phi-notes-hardening.md`

- [ ] **Step 1: Run downstream generated-notes checks**

Feed accepted candidate notes into the existing downstream track using original source as the authority. Verify that owner, deadline, condition, withdrawal, correction, and unrelated-topic boundaries survive any extracted commitments or proposals. A downstream consumer quoting candidate notes is not sufficient evidence; adjudicate against the original transcript fixture.

- [ ] **Step 2: Run the disposable 30-minute mixed workload**

Exercise recording plus permitted local intelligence with Phi notes, repeated cached navigation, and foreground Ask Pluto preemption. Sample memory pressure, swap occupancy/paging, thermal state, process RSS, Ollama residency, capture markers, transcript delay, and queue transitions once per second. Stop under the frozen critical-pressure/recording/privacy rules.

Pass requires zero lost markers/chunks, no more than 10% p95 live-transcript delay regression, no serious/critical thermal state lasting over 30 seconds, no sustained critical memory pressure, and no more than 512 MiB swap-occupancy growth from a settled baseline.

- [ ] **Step 3: Verify the entire change**

```bash
rtk pnpm rebuild better-sqlite3
rtk pnpm run test -- --reporter=dot
rtk pnpm run ensure:sqlite-abi
rtk pnpm exec tsc --noEmit
rtk pnpm run lint
rtk pnpm run changelog:check
rtk git diff --check origin/master...HEAD
```

Expected: all tests PASS; Electron SQLite ABI is restored after Node/Vitest; lint, TypeScript, changelog, and diff checks are clean.

- [ ] **Step 4: Make the decision without bundling a default change**

If any integrity, human-review, downstream, recording, or resource gate fails, keep Gemma routing and close the experiment with the failure evidence. If all gates pass, merge the evaluator/pipeline hardening first with the experimental option still disabled, then open a separate small routing PR that changes notes selection to Phi, bumps cache/prompt identity, adds a selected-meeting canary, preserves existing notes, and documents one-step rollback to Gemma.

- [ ] **Step 5: Commit the integrated report and changelog**

```bash
rtk git add tests/manual/localIntelligenceMixedWorkload.test.ts docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md docs/changelog/entries/2026-09-07-788-phi-notes-hardening.md
rtk git commit -m "test: complete Phi notes promotion gates"
```

## Plan self-review checklist

- The evaluator is fixed before prompt/pipeline tuning, so the known false passes cannot define success.
- The previously inspected corpus is development-only; promotion uses new frozen cases.
- The source-first route reuses existing parsers, guardrails, editor preservation, call limits, cancellation, and residency behavior.
- Model-specific selection is an explicit evaluation option, not a hidden check inside shared production code.
- Prompt guidance describes general semantic failure classes and contains no evaluated entity names.
- Automated triage, independent agent review, blinded human review, downstream evidence, and integrated runtime evidence remain distinct.
- A routing/default change is a separate reversible decision after every gate passes.
