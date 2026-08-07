# Implementation Plan: Local Model Action Item & Decision Extraction

**Issue**: [#594](https://github.com/metagrover/pluto/issues/594)  
**Spec**: `docs/superpowers/specs/2026-08-07-local-model-action-item-extraction-design.md`  

---

## Tasks

### Task 1: Update Types and Prompts
- Modify `electron/llm/analysisTypes.ts` to add optional `evidence?: string` to `ActionItemV3` and `DecisionV3`.
- Update `getTopicAnalysisPrompt` in `electron/llm/prompts.ts` to request `evidence` string for decisions and action items.

### Task 2: Refactor Grounding in `unifiedProvider.ts`
- Update `applyTranscriptGrounding()` in `electron/llm/unifiedProvider.ts` to stop purging action items/decisions based on single-line exact keyword matching.
- Implement soft transcript grounding (check token overlap or substring match across full window/transcript without keyword gating).
- Preserve all LLM-extracted decisions and action items in the return value while setting error metadata if grounding score is low.

### Task 3: Update Unit Tests
- Update `tests/unit/analysisDocumentV3.test.ts` and `tests/unit/meetingNotesQuality.test.ts` to ensure all tests pass with the new grounding behavior.

### Task 4: Record Durable Memory & Changelog
- Update `docs/decisions.md` with the decision to rely on local LLM extraction and soft grounding rather than hardcoded keyword filters.
- Add `docs/changelog/entries/2026-08-07-local-model-action-item-extraction.md`.

### Task 5: Run Verification
- Run `pnpm test` to confirm test suite passes.
- Run `npx tsc-node scripts/reanalyze_recent_meetings.ts` to verify local DB meeting extraction quality.
