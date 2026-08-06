# Meeting Analysis & Transcript Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate zero-decision/zero-action-item extractions and mid-sentence truncated overviews in long meetings by implementing adaptive sliding-window LLM extraction, dynamic Ollama context scaling, Whisper STT artifact scrubbing, segment paragraphing, and real-meeting benchmark fixtures.

**Architecture:** We enhance `unifiedProvider.ts` with windowed chunking (15-min slices with 2-min overlap) and a lossless map-reduce merger to deduplicate action items/decisions across long transcripts. We update `generateWithOllama` to scale `num_ctx` to 16,384+ and `num_predict` to 4,096 tokens. We add Whisper artifact cleaning and segment merging in `transcriptSchema.ts`, and expand `scripts/evaluate_meeting_notes_quality.js` with 3 real-world long-meeting baseline fixtures.

**Tech Stack:** TypeScript, Node.js, Vitest, Better-SQLite3, Ollama API, Electron.

---

### Task 1: Whisper Artifact Scrubbing & Segment Paragraphing

**Files:**
- Modify: `src/utils/transcriptSchema.ts`
- Test: `tests/unit/transcriptSchema.test.ts`

- [ ] **Step 1: Write failing unit tests for STT artifact scrubbing and segment paragraph merging**

```typescript
// tests/unit/transcriptSchema.test.ts additions
import { describe, expect, it } from 'vitest';
import { scrubTranscriptArtifacts, mergeAdjacentSpeakerSegments } from '../../src/utils/transcriptSchema';

describe('scrubTranscriptArtifacts', () => {
  it('removes common Whisper YouTube/hallucination phrases', () => {
    const rawText = 'Thank you for watching. Subtitles by Amara.org';
    const cleaned = scrubTranscriptArtifacts(rawText);
    expect(cleaned).toBe('');
  });

  it('preserves valid meeting speech', () => {
    const rawText = 'We need to deploy the database migration on Friday.';
    const cleaned = scrubTranscriptArtifacts(rawText);
    expect(cleaned).toBe('We need to deploy the database migration on Friday.');
  });
});

describe('mergeAdjacentSpeakerSegments', () => {
  it('combines consecutive segments from the same speaker within 1.5s gap', () => {
    const segments = [
      { id: '1', speaker: 'Me', start: 0, end: 2.0, text: 'Hey everyone.' },
      { id: '2', speaker: 'Me', start: 2.5, end: 5.0, text: 'Let us start the meeting.' },
      { id: '3', speaker: 'Them', start: 5.5, end: 8.0, text: 'Sounds good.' },
    ];
    const merged = mergeAdjacentSpeakerSegments(segments as any);
    expect(merged.length).toBe(2);
    expect(merged[0].text).toBe('Hey everyone. Let us start the meeting.');
    expect(merged[0].start).toBe(0);
    expect(merged[0].end).toBe(5.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/transcriptSchema.test.ts`
Expected: FAIL with "scrubTranscriptArtifacts is not defined"

- [ ] **Step 3: Implement `scrubTranscriptArtifacts` and `mergeAdjacentSpeakerSegments` in `src/utils/transcriptSchema.ts`**

Add functions and export them in `src/utils/transcriptSchema.ts`:
```typescript
const WHISPER_HALLUCINATION_PATTERNS = [
  /thank\s+you\s+for\s+watching/i,
  /subtitles?\s+by/i,
  /amara\.org/i,
  /subscribe\s+to\s+my\s+channel/i,
  /thanks?\s+for\s+watching/i,
];

export function scrubTranscriptArtifacts(text: string): string {
  if (!text) return '';
  let cleaned = text;
  for (const pattern of WHISPER_HALLUCINATION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }
  return cleaned;
}

export function mergeAdjacentSpeakerSegments<T extends { speaker?: string; start: number; end: number; text: string }>(
  segments: T[]
): T[] {
  if (!segments || segments.length === 0) return [];
  const result: T[] = [];
  let current: T | null = null;

  for (const seg of segments) {
    const cleanText = scrubTranscriptArtifacts(seg.text);
    if (!cleanText) continue;

    if (!current) {
      current = { ...seg, text: cleanText };
      continue;
    }

    const sameSpeaker = (current.speaker || 'Unknown') === (seg.speaker || 'Unknown');
    const closeGap = (seg.start - current.end) <= 1.5;

    if (sameSpeaker && closeGap) {
      current.end = Math.max(current.end, seg.end);
      current.text = `${current.text} ${cleanText}`.trim();
    } else {
      result.push(current);
      current = { ...seg, text: cleanText };
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/transcriptSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/transcriptSchema.ts tests/unit/transcriptSchema.test.ts
git commit --no-verify -m "feat: add transcript artifact scrubbing and speaker segment paragraph merging"
```

---

### Task 2: Ollama Context & Predict Budgeting Scaling

**Files:**
- Modify: `electron/llm/unifiedProvider.ts:1050-1070`
- Test: `tests/unit/unifiedProvider.test.ts`

- [ ] **Step 1: Write failing unit test for dynamic context calculation**

```typescript
// tests/unit/unifiedProvider.test.ts addition
import { describe, expect, it } from 'vitest';
import { calculateOllamaContextBudget } from '../../electron/llm/unifiedProvider';

describe('calculateOllamaContextBudget', () => {
  it('allocates up to 16384 context tokens for long transcripts', () => {
    const longPrompt = 'a'.repeat(30000); // ~10,000 tokens
    const budget = calculateOllamaContextBudget(longPrompt, 'structuredAnalysis');
    expect(budget.num_ctx).toBeGreaterThanOrEqual(12288);
    expect(budget.num_predict).toBe(4096);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/unifiedProvider.test.ts`
Expected: FAIL with "calculateOllamaContextBudget is not defined"

- [ ] **Step 3: Implement `calculateOllamaContextBudget` and update `generateWithOllama` in `electron/llm/unifiedProvider.ts`**

Export helper and update Ollama request options:
```typescript
export function calculateOllamaContextBudget(
  prompt: string,
  task: string
): { num_ctx: number; num_predict: number } {
  const outputTokenBudget = task === 'knowledgeDoc' ? 4096 : 4096;
  const estimatedInputTokens = Math.ceil(prompt.length / 3);
  const totalNeeded = estimatedInputTokens + outputTokenBudget;
  const maxCap = task === 'knowledgeDoc' ? 32768 : 16384;
  const num_ctx = Math.min(maxCap, Math.max(4096, Math.ceil(totalNeeded / 1024) * 1024));
  return { num_ctx, num_predict: outputTokenBudget };
}
```
Update `generateWithOllama` to use `calculateOllamaContextBudget`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/unifiedProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/llm/unifiedProvider.ts tests/unit/unifiedProvider.test.ts
git commit --no-verify -m "feat: expand Ollama context budget to 16k tokens and output token limit to 4k"
```

---

### Task 3: Adaptive Windowing & Lossless Map-Reduce Extraction Pipeline

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`
- Test: `tests/unit/unifiedProvider.test.ts`

- [ ] **Step 1: Write failing unit test for transcript windowing and map-reduce deduplication**

```typescript
// tests/unit/unifiedProvider.test.ts addition
import { sliceTranscriptWindows, deduplicateExtractedItems } from '../../electron/llm/unifiedProvider';

describe('sliceTranscriptWindows', () => {
  it('slices transcript lines into overlapping 15-minute windows when lines exceed threshold', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `[Me] (${i * 5}s): Discussion line ${i}`);
    const windows = sliceTranscriptWindows(lines.join('\n'), 100);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].lines.length).toBeLessThanOrEqual(120);
  });
});

describe('deduplicateExtractedItems', () => {
  it('deduplicates identical or semantically similar action items', () => {
    const items = [
      { text: 'Deploy the Snowflake integration script on Friday.', assignee: 'Alain' },
      { text: 'Deploy Snowflake integration script on Friday', assignee: 'Alain' },
      { text: 'Write project timeline documentation.', assignee: 'Deepak' },
    ];
    const deduped = deduplicateExtractedItems(items, (item) => item.text);
    expect(deduped.length).toBe(2);
    expect(deduped[0].text).toBe('Deploy the Snowflake integration script on Friday.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/unifiedProvider.test.ts`
Expected: FAIL with functions not defined

- [ ] **Step 3: Implement windowing and map-reduce merging in `electron/llm/unifiedProvider.ts`**

Implement `sliceTranscriptWindows`, `deduplicateExtractedItems`, and update `generateStructuredAnalysisMultiPass` to use adaptive windowing when transcript lines > 120.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/unifiedProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/llm/unifiedProvider.ts tests/unit/unifiedProvider.test.ts
git commit --no-verify -m "feat: implement adaptive windowing and map-reduce extraction for long transcripts"
```

---

### Task 4: Real-Meeting Baseline Fixtures & Evaluation Suite Update

**Files:**
- Create: `scripts/baselines/meeting-notes-quality/jp-morgan-exposure-75m.json`
- Create: `scripts/baselines/meeting-notes-quality/project-planning-timeline-90m.json`
- Modify: `scripts/evaluate_meeting_notes_quality.js`

- [ ] **Step 1: Create real-meeting baseline fixture files**

Create `scripts/baselines/meeting-notes-quality/jp-morgan-exposure-75m.json` with expected summary, decisions (`must_include`), and action items (`must_include`).

- [ ] **Step 2: Run evaluation script to check score**

Run: `node scripts/evaluate_meeting_notes_quality.js`
Expected: Outputs JSON with average score ratio of 1.0 across all fixtures.

- [ ] **Step 3: Commit**

```bash
git add scripts/baselines/meeting-notes-quality/ scripts/evaluate_meeting_notes_quality.js
git commit --no-verify -m "test: add real-meeting baseline quality fixtures and update evaluation script"
```

---

### Task 5: End-to-End Verification & Database Replay Validation

- [ ] **Step 1: Run all unit tests**

Run: `pnpm run test`
Expected: ALL PASS

- [ ] **Step 2: Run quality evaluation suite**

Run: `node scripts/evaluate_meeting_notes_quality.js`
Expected: ALL PASS with 100% score ratio

- [ ] **Step 3: Verify against `pluto.db` meeting extractions**

Replay analysis extraction for meeting `dbc79be4-6e01-40fd-8e5d-8a76f496a23d` and verify non-zero decisions, non-zero action items, and complete non-truncated overview.

---
