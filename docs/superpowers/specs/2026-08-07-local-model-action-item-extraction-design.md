# Design Spec: Local Model Action Item & Decision Extraction

**Issue**: [#594](https://github.com/metagrover/pluto/issues/594)  
**Date**: 2026-08-07  
**Status**: Approved  

---

## 1. Overview & Problem

Meeting analysis in Pluto relies on task-scoped local LLMs (`qwen3.5:9b` for structured analysis, Phi for other latency-sensitive Ollama tasks) and cloud providers. However, empirical analysis of `pluto.db` revealed that **98.8% of meetings had 0 action items** and **96.3% of meetings had 0 decisions**.

The root cause was identified in `applyTranscriptGrounding()` in `electron/llm/unifiedProvider.ts`:
- LLM outputs valid, paraphrased action items (e.g. *"Draft Snowflake pipeline RFC"* when spoken: *"I can write up a doc for the pipeline team"*).
- Post-processing code runs `hasSupportInTranscript()`, which requires **token overlap $\ge 0.6$ on a single line** AND an **exact keyword match** from a small list (`"i'll"`, `"i will"`, `"send"`, `"draft"`, `"decided"`).
- Paraphrased items fail this rigid check and are silently purged.

---

## 2. Proposed Changes

### 2.1 Prompt & Schema Update (`electron/llm/prompts.ts` & `electron/llm/analysisTypes.ts`)
- Update `getTopicAnalysisPrompt` to request an optional `evidence` quote string for each extracted `action_item` and `decision`.
- Example schema:
  ```json
  {
    "action_items": [
      {
        "text": "Draft Snowflake pipeline RFC",
        "assignee": "Deepak",
        "due": "Friday",
        "evidence": "write up a doc for the pipeline team"
      }
    ],
    "decisions": [
      {
        "text": "Use Snowflake for data warehousing",
        "decided_by": "Team",
        "evidence": "we agreed on Snowflake"
      }
    ]
  }
  ```

### 2.2 Grounding Logic Refactoring (`electron/llm/unifiedProvider.ts`)
- Remove `hasSupportInTranscript()` single-line keyword matching.
- Remove `decisionSupportKeywords()` and `actionSupportKeywords()` hardcoded string lists.
- Implement soft transcript grounding:
  - If `evidence` quote is provided, verify it is present in the transcript window (using case-insensitive substring or token match).
  - If no `evidence` quote is provided, fall back to checking if key terms in `text` appear in the transcript window.
  - If an item fails soft grounding, keep it but mark `error_categories: ["unsupported_action_item"]` or `["unsupported_decision"]` in metadata rather than discarding the item from user-facing notes.

---

## 3. Verification Plan

1. **Unit Tests**:
   - Run `pnpm test` (`tests/unit/analysisDocumentV3.test.ts`, `tests/unit/meetingNotesQuality.test.ts`, `tests/unit/enrichment.test.ts`).
2. **Re-analysis Script**:
   - Run `scripts/reanalyze_recent_meetings.ts` against local `pluto.db` and verify action items and decisions are extracted and preserved.
