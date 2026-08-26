# Analysis Quality Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep oversized meeting notes substantive, modality-safe, commitment-complete, and visibly honest when local analysis degrades.

**Architecture:** Tighten the existing deterministic oversized-topic compactor instead of adding a new model pass. Strengthen the shared prompt contract so settled-item text reuses evidence vocabulary and uncertain terminology/modality remains explicit, then translate privacy-safe generation categories into persisted quality issues rendered as one restrained inline notice in Meeting View.

**Tech Stack:** TypeScript, React, Vitest, Biome, Electron/Ollama structured analysis.

---

### Task 1: Preserve substantive content during oversized compaction

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`
- Test: `tests/unit/analysisTopicCompaction.test.ts`

- [ ] **Step 1: Write failing compaction tests**

Add cases proving that a generic empty-analysis topic is dropped when substantive topics exist, and that generic empty summaries/key points cannot overwrite a cluster containing real content or commitments.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm exec vitest run tests/unit/analysisTopicCompaction.test.ts`

Expected: FAIL because `collapseOversizedTopics` currently ranks and preserves “no substantive discussion” text as ordinary content.

- [ ] **Step 3: Add the minimal empty-analysis classifier and compaction guard**

In `electron/llm/unifiedProvider.ts`, add a private predicate for known generic empty-analysis language. Use it only to rank/filter summaries and synthesized key points when another substantive topic exists. Do not discard topics containing decisions, actions, open questions, or non-generic key points.

- [ ] **Step 4: Verify the compaction tests pass**

Run: `pnpm exec vitest run tests/unit/analysisTopicCompaction.test.ts`

Expected: PASS.

### Task 2: Preserve modality, raw terminology, and evidence-compatible commitment wording

**Files:**
- Modify: `electron/llm/prompts.ts`
- Test: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing prompt-contract tests**

Assert that every structured-analysis prompt requires action/decision text to reuse the supporting evidence vocabulary, forbids silently expanding or replacing ambiguous internal terms, and forbids converting tentative targets, recommendations, forecasts, or uncertain consequences into commitments or policy.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because the current shared policy has broad uncertainty guidance but not these exact deterministic contracts.

- [ ] **Step 3: Tighten `STRUCTURED_EXTRACTION_POLICY` and editorial wording**

Add concise shared rules that:

- keep tentative scheduling and forecasts explicitly tentative in summaries;
- prevent recommendations and possible consequences from becoming policies or settled facts;
- preserve ambiguous internal wording verbatim unless repeated context or user notes confirm a correction;
- phrase action/decision text as a bare verb phrase using the evidence clause's nouns and verbs, avoiding synonym-heavy paraphrase that exact grounding cannot verify.

- [ ] **Step 4: Verify prompt tests pass**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: PASS.

### Task 3: Persist and render a calm degraded-analysis notice

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `src/components/features/MeetingNotesDocument.tsx`
- Modify: `src/index.css`
- Test: `tests/unit/unifiedProvider.test.ts`
- Test: `tests/unit/MeetingNotesDocument.dom.test.tsx`

- [ ] **Step 1: Write failing provider and DOM tests**

Provider test: an oversized or grounding-degraded result remains usable but includes a short privacy-safe `quality.issues` message.

DOM test: a meeting whose V3 analysis contains quality issues renders one `role="status"` notice reading “Some details may be missing. Pluto kept only transcript-backed actions and decisions.” A clean analysis renders no notice.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm exec vitest run tests/unit/unifiedProvider.test.ts tests/unit/MeetingNotesDocument.dom.test.tsx`

Expected: FAIL because generation categories are metadata-only and Meeting Notes does not render them.

- [ ] **Step 3: Map categories to quality issues**

In `finalizeStructuredAnalysis`, add only two privacy-safe issue strings: one for limited meeting-wide consolidation (`editorial_input_too_large`, `editorial_invalid_json`, or `editorial_failed`) and one for omitted/unverified settled items (`unsupported_action_item`, `unsupported_decision`, `conflicting_rollups`, or `editorial_dropped_settled_item`). Keep `format_pass` about valid structure and keep `fallback_used=false` for usable degraded notes.

- [ ] **Step 4: Render the notice without adding a card**

Parse `meeting.analysis_json` defensively inside `MeetingNotesDocument`, derive whether `quality.issues` is non-empty, and render one restrained inline status above the generated sections. Style it with existing notes-paper/ink tokens, a subtle full border, compact type, no side stripe, no motion, and no new accent color.

- [ ] **Step 5: Verify provider and DOM tests pass**

Run: `pnpm exec vitest run tests/unit/unifiedProvider.test.ts tests/unit/MeetingNotesDocument.dom.test.tsx`

Expected: PASS.

### Task 4: Record and verify issue #671

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-26-671-preserve-analysis-quality.md`

- [ ] **Step 1: Record the durable behavior**

Document that valid JSON and trustworthy analysis are separate states: degraded analyses remain available, but generic empty synthesis is discarded in favor of substantive local evidence and quality limitations are visible.

- [ ] **Step 2: Add the changelog fragment**

Describe the user outcome without private meeting content: long notes retain substantive topics and grounded commitments, preserve uncertainty, and disclose limited synthesis.

- [ ] **Step 3: Run focused and static verification**

Run:

```bash
pnpm exec vitest run tests/unit/analysisTopicCompaction.test.ts tests/unit/prompts.test.ts tests/unit/unifiedProvider.test.ts tests/unit/analysisGrounding.test.ts tests/unit/MeetingNotesDocument.dom.test.tsx
pnpm exec biome check electron/llm/unifiedProvider.ts electron/llm/prompts.ts src/components/features/MeetingNotesDocument.tsx tests/unit/analysisTopicCompaction.test.ts tests/unit/prompts.test.ts tests/unit/unifiedProvider.test.ts tests/unit/MeetingNotesDocument.dom.test.tsx docs/changelog/entries/2026-08-26-671-preserve-analysis-quality.md
pnpm run typecheck
pnpm run changelog:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Review the final diff against issue #671**

Confirm every changed line traces to substantive compaction, modality/terminology contracts, quality disclosure, tests, or required traceability. Confirm the main checkout's issue #670 files remain untouched.
