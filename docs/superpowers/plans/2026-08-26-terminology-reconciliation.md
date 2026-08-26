# Terminology reconciliation implementation plan

**Issue:** #672
**Design:** `docs/superpowers/specs/2026-08-26-general-purpose-terminology-reconciliation-design.md`

## Goal

Add a bounded, meeting-scoped terminology reconciliation pass to local multi-pass analysis, strengthen the general-purpose analysis prompt contract, preserve canonical transcript evidence, and persist truthful generation provenance.

## Task 1: General-purpose analysis prompt contract

**Files:**
- Modify: `electron/llm/prompts.ts`
- Test: `tests/unit/prompts.test.ts`

1. Add failing prompt-contract assertions covering substantive-range coverage, modality preservation, evidence-first commitments, coherent topic boundaries, and prohibition on generic absence prose.
2. Run the focused prompt tests and confirm the new assertions fail.
3. Add one shared policy block used by structured, repair, topic, and editorial prompts, plus segmentation-specific cohesion and candidate-discovery rules.
4. Run the prompt tests and confirm they pass.

## Task 2: Terminology domain and deterministic gate

**Files:**
- Create: `electron/llm/terminologyReconciliation.ts`
- Create: `tests/unit/terminologyReconciliation.test.ts`
- Modify: `electron/llm/analysisTypes.ts`

1. Add failing tests for parsing bounded candidates, rejecting candidates not found in referenced transcript lines, grouping variants, request caps, and protecting ordinary words/numbers/dates/negation/speaker labels.
2. Add failing tests proving that model confidence alone cannot apply a correction, while high-confidence known-term, spoken-definition, or consistent-variant evidence can.
3. Implement minimal versioned candidate, proposal, and artifact types plus pure validation, aggregation, proposal gating, terminology prompt-context, and grounding-alias helpers.
4. Run the new unit suite until green.

## Task 3: Bounded local-provider reconciliation

**Files:**
- Modify: `electron/llm/prompts.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `electron/llm/provider.ts`
- Test: `tests/unit/unifiedProvider.test.ts`
- Test: `tests/unit/prompts.test.ts`

1. Add failing tests that topic segmentation requests bounded terminology candidates and that the Ollama path performs all segmentation before exactly one reconciliation call.
2. Add the `terminologyReconciliation` task budget and prompt returning proposals only.
3. Refactor multi-pass planning into a bounded first phase that collects topic plans and candidates, then reconcile once, then analyze topics with applied aliases.
4. Preserve safe no-op behavior on invalid JSON, timeout, no candidates, or rejected proposals, recording only a content-free error category.
5. Run provider and prompt tests until green.

## Task 4: Alias-aware grounding without evidence mutation

**Files:**
- Modify: `electron/llm/analysisGrounding.ts`
- Test: `tests/unit/analysisGrounding.test.ts`

1. Add failing tests where a supported preferred spelling survives claim grounding against verbatim raw evidence.
2. Add negative tests showing aliases cannot change evidence, numbers, negation, owner, deadline, or modality checks.
3. Add optional applied aliases to claim-token comparison only; keep evidence resolution and settled-field validation unchanged.
4. Run grounding tests until green.

## Task 5: Persist terminology and truthful regeneration metadata

**Files:**
- Modify: `electron/llm/analysisTypes.ts`
- Modify: `electron/llm/analysisDocumentV3.ts`
- Modify: `src/components/features/MeetingView.tsx`
- Test: `tests/unit/analysisDocumentV3.test.ts`
- Test: relevant Meeting View DOM test

1. Add failing round-trip tests for versioned terminology metadata and content-free terminology failure categories.
2. Add failing regeneration persistence coverage for provider, model, path, prompt version, generation timestamp, error categories, and terminal downstream state.
3. Parse and persist the terminology artifact inside generation metadata and make manual regeneration copy the returned metadata atomically with analysis.
4. Run focused persistence and renderer tests until green.

## Task 6: Verification and representative evaluation

1. Run focused terminology, prompt, grounding, analysis-document, provider, and Meeting View tests.
2. Run Biome on changed source and tests plus `git diff --check`.
3. Run the broader analysis test group and build/typecheck appropriate to the changed boundary.
4. Regenerate the saved representative meeting with the configured local model when available; compare transcript hash, terminology decisions, coverage, modality, commitments, generation metadata, and lifecycle terminal state.
5. Record measured results and any safe no-op limitation on #672 without logging private raw terminology.
6. Add a uniquely named changelog fragment, commit the implementation, push the branch, and update/close #672 only when acceptance criteria are evidenced.
