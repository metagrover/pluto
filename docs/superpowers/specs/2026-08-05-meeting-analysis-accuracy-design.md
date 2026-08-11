# Design Spec: Meeting Transcript & Analysis Accuracy Improvement

**Date**: 2026-08-05  
**Target**: Pluto Meeting Assistant (Electron + Node.js + Ollama LLM + Python WhisperX STT)  
**Status**: Draft for Approval  

---

## 1. Problem Statement & Root Cause

Our audit of real meeting data in `pluto.db` revealed two major quality breakdowns in long multi-speaker meetings:

1. **Zero Decisions & Zero Action Items Extracted in Long Meetings**:
   - In meetings longer than 20 minutes (e.g. 75-min *JP Morgan Asset Exposure Analysis* and 92-min *Project Planning Review*), `all_decisions` and `all_action_items` in `analysis_json` are empty (`[]`).
   - **Root Cause**: `generateWithOllama` in `electron/llm/unifiedProvider.ts` hardcodes `num_ctx` to `8192` for analysis tasks. A 75-minute meeting transcript exceeds 10,000–15,000 tokens. Ollama silently truncates the prompt, dropping the context mid-meeting. Pass 1 (`topicSegmentation`) fails on the truncated text, falling back to a single 9,999-segment `General Discussion` bucket that fails Pass 2 extraction.
2. **Truncated Overviews & Generic Fallbacks**:
   - Meeting overviews cut off mid-sentence (`"...connecting with colleagues who haven'"`) or fallback to generic text (`"Conversation captured. See topics below for details."`).
3. **Coarse Speaker Attribution & STT Noise**:
   - External participants are flattened into `Them` instead of distinct speaker turns.
   - Silence or background audio produces Whisper STT hallucination artifacts (e.g. `"Thank you for watching"`).

---

## 2. Model Recommendations (Ollama Local Runtime)

Based on the scope of Pluto as an offline-first "second brain" meeting assistant:

### **Primary Recommendation: `qwen2.5:7b-instruct` or `llama3.1:8b-instruct`**
* **`qwen2.5:7b-instruct`** (4.7 GB): **Best overall for structured JSON extraction**. Superior adherence to complex JSON schemas, high precision on action item assignees/due dates, and lower JSON syntax repair failure rate.
* **`llama3.1:8b-instruct`** (4.9 GB): **Best for long-context reasoning**. Native 128k context window support in Ollama, strong instruction-following for multi-speaker discussions.

### **Secondary / Low-RAM Alternative: `llama3.2:3b-instruct`**
* **`llama3.2:3b-instruct`** (2.0 GB, already installed locally): Significantly better instruction-following and JSON formatting performance than `phi4-mini:3.8b` for lower-resource environments.

---

## 3. Proposed Architecture & System Changes

### Component 1: Ollama Transport & Context Budgeting ([`electron/llm/unifiedProvider.ts`](file:///Users/metagrover/Desktop/pluto/electron/llm/unifiedProvider.ts))
* **Dynamic Context Calculation**: Update `generateWithOllama` to dynamically scale `num_ctx` up to `16384` or `32768` when model memory supports it, or automatically invoke windowed chunking when transcript tokens exceed `6000` tokens.
* **Increased Predict Budget**: Increase `num_predict` for analysis tasks from 2500 to 4096 tokens to eliminate truncated overview sentences.

### Component 2: Adaptive Sliding-Window Extraction Pipeline ([`electron/llm/unifiedProvider.ts`](file:///Users/metagrover/Desktop/pluto/electron/llm/unifiedProvider.ts))
* **15-Minute Window Slicing**: For transcripts exceeding 120 segments (~15 minutes), split transcript segments into overlapping windows (15-min window, 2-min overlap).
* **Per-Window JSON Extraction**: Run parallel/sequential extraction per window for topics, key points, decisions, and action items.
* **Lossless Map-Reduce Merge**:
  * Combine extracted decisions and action items into global lists.
  * Deduplicate overlapping decisions/action items using Jaccard text similarity (threshold 0.75).
  * Synthesize the top-level `overview` from the consolidated key points.

### Component 3: Transcript Cleaning & Paragraph Merging ([`src/utils/transcriptSchema.ts`](file:///Users/metagrover/Desktop/pluto/src/utils/transcriptSchema.ts))
* **Whisper Hallucination Scrubbing**: Filter out known STT artifacts (`"Thank you for watching"`, `"Subtitles by..."`, `"Amara.org"`, repeated silence tokens).
* **Segment Paragraph Consolidation**: Merge adjacent transcript segments from the same speaker with timestamp gaps < 1.5s into single paragraph utterances.

### Component 4: Real-Meeting Quality Benchmark Suite ([`scripts/evaluate_meeting_notes_quality.js`](file:///Users/metagrover/Desktop/pluto/scripts/evaluate_meeting_notes_quality.js))
* Add 3 new real-world meeting baseline fixtures in `scripts/baselines/meeting-notes-quality/`:
  1. `jp-morgan-exposure-75m.json` (Long multi-topic meeting)
  2. `project-planning-timeline-90m.json` (Action-item heavy meeting)
  3. `multi-speaker-tech-sync-25m.json` (Multi-participant attribution)
* Enforce automated quality score assertion in tests (`score_ratio >= 0.85`).

---

## 4. Verification & Testing Strategy

1. **Unit Tests**:
   - Test sliding-window slicing logic and map-reduce deduplication in `unifiedProvider.test.ts`.
   - Test Whisper hallucination scrubbing and segment paragraphing in `transcriptSchema.test.ts`.
2. **Benchmark Evaluation**:
   - Run `node scripts/evaluate_meeting_notes_quality.js` against all baseline fixtures to verify 100% recall of decisions and action items.
3. **Database Replay Integration**:
   - Replay analysis generation against actual meeting `dbc79be4-6e01-40fd-8e5d-8a76f496a23d` in `pluto.db` and verify non-zero action items, non-zero decisions, and complete overview text.

---
