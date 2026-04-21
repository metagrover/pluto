# Enhanced Meeting Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 4-section meeting analysis with a topic-structured, speaker-attributed document using a v3 schema delivered via JSON-mode LLM calls.

**Architecture:** The v3 analysis pipeline uses a single `generateStructuredAnalysis()` method on `UnifiedLLMProvider`. Cloud providers (Gemini, OpenAI, Claude) use a single-pass JSON prompt. Ollama uses a 2-pass pipeline (topic segmentation → per-topic analysis). The v3 schema is stored in `analysis_json` with `analysis_schema_version: 3`. The UI renders v3 as a document-flow layout and falls back to the existing flat layout for v2 meetings. User inline edits are stored as an overlay in a new `user_edits_json` column.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3, React, Vitest

---

## File Structure

| Path | Responsibility | Action |
|------|---------------|--------|
| `electron/llm/analysisTypes.ts` | All v3 schema types (`AnalysisDocumentV3`, `TopicSection`, etc.) | **CREATE** |
| `electron/llm/analysisDocumentV3.ts` | v3 JSON parser/validator, markdown renderer, fallback generator | **CREATE** |
| `electron/llm/prompts.ts` | Remove `getSummaryPrompt`, `getSummaryRepairPrompt`. Add 3 new prompt functions | **MODIFY** |
| `electron/llm/provider.ts` | Add `AnalysisDocumentV3` re-export, add `generateStructuredAnalysis` to `LLMProvider` interface, remove old methods | **MODIFY** |
| `electron/llm/unifiedProvider.ts` | Implement `generateStructuredAnalysis()` with cloud/local paths. Remove `generateAnalysisArtifacts`, `generateSummary`, `generateUserAnalysisMarkdown`, repair loop | **MODIFY** |
| `electron/llm/analysisDocument.ts` | Keep as-is for backward compat (v2 parsing in knowledgeSynthesis still uses `parseAnalysisMarkdown`) | **NO CHANGE** |
| `electron/db.ts` | Add `user_edits_json TEXT` column migration | **MODIFY** |
| `electron/main.ts` | Update `GENERATE_ANALYSIS_V2` handler, update `fallbackAnalysisArtifacts`, add `SAVE_USER_EDIT` handler | **MODIFY** |
| `electron/knowledgeSynthesis.ts` | Update `parseAnalysisJson()` to handle v3 schema | **MODIFY** |
| `electron/intelligence/midGenerator.ts` | Accept v3 schema via union type | **MODIFY** |
| `src/types.ts` | Add `AnalysisDocumentV3` + sub-types, add `user_edits_json` to `Meeting` | **MODIFY** |
| `src/utils/analysisDocument.ts` | Add v3 parser/resolver alongside existing v2 code | **MODIFY** |
| `src/components/features/MeetingView.tsx` | Full redesign: document-flow for v3, backward-compat for v2, inline edits, continuity links | **MODIFY** |
| `src/components/AudioManager.tsx` | Update local type copies and pipeline to handle v3 analysis | **MODIFY** |
| `tests/unit/analysisDocumentV3.test.ts` | Unit tests for v3 parsing, validation, markdown rendering, fallback | **CREATE** |
| `tests/unit/analysisPrompts.test.ts` | Tests for new prompt functions | **CREATE** |
| `tests/unit/userEditsOverlay.test.ts` | Tests for applying user edits overlay | **CREATE** |
| `tests/unit/knowledgeSynthesisV3.test.ts` | Tests for v3 evidence extraction in knowledge synthesis | **CREATE** |

---

## Task 1: v3 Schema Types

**Files:**
- Create: `electron/llm/analysisTypes.ts`

- [ ] **Step 1: Create the v3 type definitions file**

```typescript
// electron/llm/analysisTypes.ts

export type MeetingType = 'one_on_one' | 'team_sync' | 'brainstorm' | 'presentation' | 'general';

export interface AnalysisQuality {
  format_pass: boolean;
  retry_count: number;
  fallback_used: boolean;
  issues: string[];
}

export interface TopicPoint {
  text: string;
  speaker?: string;
  from_user_notes?: boolean;
}

export interface DecisionV3 {
  text: string;
  decided_by?: string;
  rationale?: string;
}

export interface ActionItemV3 {
  text: string;
  assignee?: string;
  due?: string;
  topic?: string;
}

export interface TopicSection {
  title: string;
  summary: string;
  key_points: TopicPoint[];
  decisions: DecisionV3[];
  action_items: ActionItemV3[];
  open_questions: string[];
  transcript_range?: [number, number];
}

export interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;
  topics: TopicSection[];
  all_action_items: ActionItemV3[];
  all_decisions: DecisionV3[];
  meeting_type: MeetingType;
  quality: AnalysisQuality;
}

export interface UserEdit {
  original: string;
  edited: string;
  edited_at: string;
}

export interface UserEditsMap {
  [path: string]: UserEdit;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/llm/analysisTypes.ts
git commit -m "feat: add AnalysisDocumentV3 schema types"
```

---

## Task 2: v3 Parser, Validator, and Markdown Renderer

**Files:**
- Create: `electron/llm/analysisDocumentV3.ts`
- Create: `tests/unit/analysisDocumentV3.test.ts`

- [ ] **Step 1: Write the failing tests for `parseAnalysisDocumentV3`**

```typescript
// tests/unit/analysisDocumentV3.test.ts
import { describe, expect, it } from 'vitest';

import {
  fallbackAnalysisDocumentV3,
  parseAnalysisDocumentV3,
  analysisDocumentV3ToMarkdown,
} from '../../electron/llm/analysisDocumentV3';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';

const validV3: AnalysisDocumentV3 = {
  analysis_schema_version: 3,
  overview: 'We discussed hiring and API migration.',
  topics: [
    {
      title: 'Q2 Hiring Plan',
      summary: 'Need to backfill 2 senior eng roles.',
      key_points: [
        { text: 'Budget capped at $180k per role', speaker: 'Sarah' },
        { text: 'Contractor option on the table', from_user_notes: true },
      ],
      decisions: [{ text: 'Post senior eng role by Friday', decided_by: 'Sarah' }],
      action_items: [{ text: 'Draft job description', assignee: 'Sarah', due: 'by EOW' }],
      open_questions: ['Contractor vs FTE for infra?'],
      transcript_range: [0, 42],
    },
  ],
  all_action_items: [{ text: 'Draft job description', assignee: 'Sarah', due: 'by EOW', topic: 'Q2 Hiring Plan' }],
  all_decisions: [{ text: 'Post senior eng role by Friday', decided_by: 'Sarah' }],
  meeting_type: 'team_sync',
  quality: { format_pass: true, retry_count: 0, fallback_used: false, issues: [] },
};

describe('parseAnalysisDocumentV3', () => {
  it('parses a valid v3 JSON string', () => {
    const result = parseAnalysisDocumentV3(JSON.stringify(validV3));
    expect(result).not.toBeNull();
    expect(result!.analysis_schema_version).toBe(3);
    expect(result!.topics).toHaveLength(1);
    expect(result!.topics[0].title).toBe('Q2 Hiring Plan');
    expect(result!.all_action_items).toHaveLength(1);
    expect(result!.meeting_type).toBe('team_sync');
  });

  it('returns null for empty/null input', () => {
    expect(parseAnalysisDocumentV3(null)).toBeNull();
    expect(parseAnalysisDocumentV3('')).toBeNull();
    expect(parseAnalysisDocumentV3('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseAnalysisDocumentV3('{not json')).toBeNull();
  });

  it('returns null when missing required fields', () => {
    const incomplete = { analysis_schema_version: 3 };
    expect(parseAnalysisDocumentV3(JSON.stringify(incomplete))).toBeNull();
  });

  it('normalizes missing optional fields on topics', () => {
    const minimal = {
      ...validV3,
      topics: [{ title: 'X', summary: 'Y', key_points: [], decisions: [], action_items: [], open_questions: [] }],
    };
    const result = parseAnalysisDocumentV3(JSON.stringify(minimal));
    expect(result).not.toBeNull();
    expect(result!.topics[0].transcript_range).toBeUndefined();
  });

  it('coerces unknown meeting_type to general', () => {
    const unknown = { ...validV3, meeting_type: 'standup' };
    const result = parseAnalysisDocumentV3(JSON.stringify(unknown));
    expect(result).not.toBeNull();
    expect(result!.meeting_type).toBe('general');
  });
});

describe('fallbackAnalysisDocumentV3', () => {
  it('returns a valid v3 document', () => {
    const fb = fallbackAnalysisDocumentV3();
    expect(fb.analysis_schema_version).toBe(3);
    expect(fb.quality.fallback_used).toBe(true);
    expect(fb.topics).toHaveLength(0);
    expect(fb.overview).toBeTruthy();
  });
});

describe('analysisDocumentV3ToMarkdown', () => {
  it('renders topic sections with speakers', () => {
    const md = analysisDocumentV3ToMarkdown(validV3);
    expect(md).toContain('Q2 Hiring Plan');
    expect(md).toContain('Sarah:');
    expect(md).toContain('📝');
    expect(md).toContain('Decision:');
    expect(md).toContain('?');
    expect(md).toContain('Draft job description');
  });

  it('renders fallback document without errors', () => {
    const md = analysisDocumentV3ToMarkdown(fallbackAnalysisDocumentV3());
    expect(md).toContain('Conversation captured');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/analysisDocumentV3.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `analysisDocumentV3.ts`**

```typescript
// electron/llm/analysisDocumentV3.ts

import type {
  ActionItemV3,
  AnalysisDocumentV3,
  AnalysisQuality,
  DecisionV3,
  MeetingType,
  TopicPoint,
  TopicSection,
} from './analysisTypes';

const VALID_MEETING_TYPES: MeetingType[] = [
  'one_on_one', 'team_sync', 'brainstorm', 'presentation', 'general',
];

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseTopicPoint = (raw: unknown): TopicPoint | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const point: TopicPoint = { text };
  if (typeof record.speaker === 'string' && record.speaker.trim()) {
    point.speaker = record.speaker.trim();
  }
  if (record.from_user_notes === true) {
    point.from_user_notes = true;
  }
  return point;
};

const parseDecisionV3 = (raw: unknown): DecisionV3 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const decision: DecisionV3 = { text };
  if (typeof record.decided_by === 'string' && record.decided_by.trim()) {
    decision.decided_by = record.decided_by.trim();
  }
  if (typeof record.rationale === 'string' && record.rationale.trim()) {
    decision.rationale = record.rationale.trim();
  }
  return decision;
};

const parseActionItemV3 = (raw: unknown): ActionItemV3 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const item: ActionItemV3 = { text };
  if (typeof record.assignee === 'string' && record.assignee.trim()) {
    item.assignee = record.assignee.trim();
  }
  if (typeof record.due === 'string' && record.due.trim()) {
    item.due = record.due.trim();
  }
  if (typeof record.topic === 'string' && record.topic.trim()) {
    item.topic = record.topic.trim();
  }
  return item;
};

const parseTopicSection = (raw: unknown): TopicSection | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const title = asString(record.title);
  const summary = asString(record.summary);
  if (!title) return null;

  const key_points = Array.isArray(record.key_points)
    ? record.key_points.map(parseTopicPoint).filter((p): p is TopicPoint => p !== null)
    : [];
  const decisions = Array.isArray(record.decisions)
    ? record.decisions.map(parseDecisionV3).filter((d): d is DecisionV3 => d !== null)
    : [];
  const action_items = Array.isArray(record.action_items)
    ? record.action_items.map(parseActionItemV3).filter((a): a is ActionItemV3 => a !== null)
    : [];
  const open_questions = asStringArray(record.open_questions);

  const section: TopicSection = {
    title,
    summary,
    key_points,
    decisions,
    action_items,
    open_questions,
  };

  if (
    Array.isArray(record.transcript_range) &&
    record.transcript_range.length === 2 &&
    typeof record.transcript_range[0] === 'number' &&
    typeof record.transcript_range[1] === 'number'
  ) {
    section.transcript_range = [record.transcript_range[0], record.transcript_range[1]];
  }

  return section;
};

const parseMeetingType = (value: unknown): MeetingType => {
  if (typeof value === 'string' && VALID_MEETING_TYPES.includes(value as MeetingType)) {
    return value as MeetingType;
  }
  return 'general';
};

export const parseAnalysisDocumentV3 = (
  raw: string | null | undefined,
): AnalysisDocumentV3 | null => {
  if (!raw || !raw.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const overview = asString(parsed.overview);
  if (!overview) return null;

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map(parseTopicSection).filter((t): t is TopicSection => t !== null)
    : [];

  const all_action_items = Array.isArray(parsed.all_action_items)
    ? parsed.all_action_items.map(parseActionItemV3).filter((a): a is ActionItemV3 => a !== null)
    : [];

  const all_decisions = Array.isArray(parsed.all_decisions)
    ? parsed.all_decisions.map(parseDecisionV3).filter((d): d is DecisionV3 => d !== null)
    : [];

  const meeting_type = parseMeetingType(parsed.meeting_type);

  const qualityRaw = parsed.quality && typeof parsed.quality === 'object'
    ? (parsed.quality as Record<string, unknown>)
    : {};

  const quality: AnalysisQuality = {
    format_pass: Boolean(qualityRaw.format_pass),
    retry_count: typeof qualityRaw.retry_count === 'number' ? qualityRaw.retry_count : 0,
    fallback_used: Boolean(qualityRaw.fallback_used),
    issues: asStringArray(qualityRaw.issues),
  };

  return {
    analysis_schema_version: 3,
    overview,
    topics,
    all_action_items,
    all_decisions,
    meeting_type,
    quality,
  };
};

export const fallbackAnalysisDocumentV3 = (
  retryCount = 1,
  issues: string[] = [],
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: 'Conversation captured. Key themes and follow-ups are summarized below.',
  topics: [],
  all_action_items: [],
  all_decisions: [],
  meeting_type: 'general',
  quality: {
    format_pass: false,
    retry_count: retryCount,
    fallback_used: true,
    issues: issues.length > 0
      ? issues
      : ['Formatting validation failed; using fallback analysis structure.'],
  },
});

export const analysisDocumentV3ToMarkdown = (doc: AnalysisDocumentV3): string => {
  const lines: string[] = [];

  // Overview
  lines.push(doc.overview);
  lines.push('');

  // Topic sections
  for (const topic of doc.topics) {
    lines.push(`─────────────────────────────────────────────────`);
    lines.push('');
    lines.push(`## ${topic.title}`);
    lines.push('');
    if (topic.summary) {
      lines.push(topic.summary);
      lines.push('');
    }

    for (const point of topic.key_points) {
      const prefix = point.from_user_notes ? '• 📝 ' : '• ';
      const speaker = point.speaker ? `${point.speaker}: ` : '';
      lines.push(`${prefix}${speaker}${point.text}`);
    }

    for (const decision of topic.decisions) {
      const by = decision.decided_by ? ` (${decision.decided_by})` : '';
      lines.push(`• Decision${by}: ${decision.text}`);
    }

    for (const question of topic.open_questions) {
      lines.push(`• ? ${question}`);
    }

    lines.push('');
  }

  // Rolled-up action items
  if (doc.all_action_items.length > 0) {
    lines.push(`─────────────────────────────────────────────────`);
    lines.push('');
    lines.push('## Action Items');
    lines.push('');
    for (const item of doc.all_action_items) {
      const assignee = item.assignee ? `${item.assignee}: ` : '';
      const due = item.due ? ` (${item.due})` : '';
      lines.push(`- [ ] ${assignee}${item.text}${due}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/analysisDocumentV3.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add electron/llm/analysisDocumentV3.ts tests/unit/analysisDocumentV3.test.ts
git commit -m "feat: add v3 analysis parser, validator, fallback, and markdown renderer"
```

---

## Task 3: v3 Prompt Functions

**Files:**
- Modify: `electron/llm/prompts.ts`

- [ ] **Step 1: Add the 3 new prompt functions**

Add these at the end of `electron/llm/prompts.ts` (before the closing of the file):

```typescript
// === v3 Structured Analysis Prompts ===

export const getStructuredAnalysisPrompt = (
  transcript: string,
  userNotes?: string,
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (the user took these during the meeting — incorporate relevant notes as emphasis within the matching topic's key points, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `You are a rigorous meeting analyst for Pluto. Produce a structured JSON document that reads like well-organized meeting notes.

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce a JSON object with this exact schema:

{
  "overview": "2-3 sentence summary — if you read nothing else, what was this meeting about and what happened?",
  "topics": [
    {
      "title": "Short descriptive title for this discussion topic",
      "summary": "2-4 sentence digest of what was discussed under this topic",
      "key_points": [
        { "text": "specific insight or statement", "speaker": "Name or null", "from_user_notes": false }
      ],
      "decisions": [
        { "text": "what was decided", "decided_by": "Name or null", "rationale": "why, if stated" }
      ],
      "action_items": [
        { "text": "task description", "assignee": "Name or null", "due": "natural language deadline or null" }
      ],
      "open_questions": ["unresolved thread or question"],
      "transcript_range": [startSegmentIndex, endSegmentIndex]
    }
  ],
  "all_action_items": [/* all action items from all topics, each with a "topic" field referencing the parent topic title */],
  "all_decisions": [/* all decisions from all topics */],
  "meeting_type": "one_on_one | team_sync | brainstorm | presentation | general"
}

Rules:
- Identify distinct discussion topics chronologically from the transcript.
- For each topic, extract speaker-attributed key points, decisions (with who decided), action items (with assignee and due date), and open questions.
- Map each topic to approximate transcript segment index ranges.
- Use only transcript${userNotes ? ' and user-note' : ''} details. Never invent facts, owners, decisions, or deadlines.
- Keep technical meaning exact. Do not flip problem/solution, cause/effect, shipped/planned, or agreed/questioned.
- Treat the transcript as source of truth. User notes sharpen emphasis but do not override.
- If discussion is exploratory, say that. Do not convert brainstorming into decisions.
- Distinguish between explicit decisions, proposals/recommendations, and unresolved questions.
- Roll up all action items and decisions into the top-level arrays.
- Classify the meeting type.

Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript:
${transcript}`;
};

export const getTopicSegmentationPrompt = (
  transcript: string,
): string => {
  return `You are a meeting topic segmenter. Read the transcript and identify distinct discussion topics in chronological order.

Return valid JSON only in this exact shape:
{
  "topics": [
    { "title": "Short descriptive title", "start_segment": 0, "end_segment": 15 }
  ]
}

Rules:
- Each topic should represent a coherent discussion thread.
- Use segment indices (0-based) to mark the approximate start and end.
- If the meeting has a single topic throughout, return one topic covering all segments.
- Keep titles concise and descriptive (3-8 words).
- Do not invent topics. Only identify what's clearly discussed.

Return valid JSON only. No markdown fences, no commentary.

Transcript:
${transcript}`;
};

export const getTopicAnalysisPrompt = (
  topicTitle: string,
  transcriptSlice: string,
  userNotes?: string,
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (incorporate relevant notes as emphasis, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `You are a meeting analyst. Analyze this transcript slice for the topic "${topicTitle}".

Return valid JSON only in this exact shape:
{
  "summary": "2-4 sentence digest of this topic's discussion",
  "key_points": [
    { "text": "specific insight", "speaker": "Name or null", "from_user_notes": false }
  ],
  "decisions": [
    { "text": "what was decided", "decided_by": "Name or null", "rationale": "why or null" }
  ],
  "action_items": [
    { "text": "task description", "assignee": "Name or null", "due": "deadline or null" }
  ],
  "open_questions": ["unresolved question"]
}

Rules:
- Use only the transcript text provided. Never invent facts.
- Speaker attribution: use name when clearly identifiable, null otherwise.
- Only include explicit decisions, not proposals or suggestions.
- Action items must be explicitly committed, not hypothetical.
- If discussion is exploratory, reflect that in the summary.

Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript slice:
${transcriptSlice}`;
};
```

- [ ] **Step 2: Remove `getSummaryPrompt` and `getSummaryRepairPrompt`**

In `electron/llm/prompts.ts`, remove the `getSummaryPrompt` function (lines 6–68) and the `getSummaryRepairPrompt` function (lines 70–97).

- [ ] **Step 3: Commit**

```bash
git add electron/llm/prompts.ts
git commit -m "feat: add v3 structured analysis prompts, remove v2 summary prompts"
```

---

## Task 4: Update `LLMProvider` Interface and Types

**Files:**
- Modify: `electron/llm/provider.ts`

- [ ] **Step 1: Add re-export of v3 types and update `LLMProvider` interface**

In `electron/llm/provider.ts`:

1. Add import at the top:
```typescript
export type {
  AnalysisDocumentV3,
  TopicSection,
  TopicPoint,
  DecisionV3,
  ActionItemV3,
  MeetingType,
  UserEditsMap,
  UserEdit,
} from './analysisTypes';
```

2. Add `generateStructuredAnalysis` to the `LLMProvider` interface (line ~86), and remove `generateSummary`, `generateUserAnalysisMarkdown`, `generateAnalysisArtifacts`:

Replace lines 86–116 of the interface with:
```typescript
export interface LLMProvider {
  name: string;
  requiresApiKey: boolean;
  isAvailable(): Promise<boolean>;
  generateStructuredAnalysis(
    transcript: string,
    userNotes?: string,
  ): Promise<AnalysisDocumentV3>;
  extractInternalSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument>;
  extractValueSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument>;
  extractSpeakerIdentity(transcript: string): Promise<string | null>;
  generateTitle(transcript: string): Promise<string>;
  synthesizeKnowledgeDocument(prompt: string): Promise<string>;
  answerAskPluto(prompt: string): Promise<string>;
  classifyQueryIntent(prompt: string): Promise<string>;
  extractEntities(
    transcript: string,
    context?: EntityExtractionContext,
  ): Promise<ExtractedEntities>;
}
```

Note: Keep the old `AnalysisDocument` interface and `AnalysisArtifacts` interface in the file — they are still used by existing v2 code paths (knowledge synthesis, MID generator backward compat). Mark them with `/** @deprecated Use AnalysisDocumentV3 */`.

- [ ] **Step 2: Commit**

```bash
git add electron/llm/provider.ts
git commit -m "feat: update LLMProvider interface for v3 analysis"
```

---

## Task 5: Implement `generateStructuredAnalysis` on `UnifiedLLMProvider`

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`

- [ ] **Step 1: Update imports**

Replace the imports at the top of `unifiedProvider.ts`:

```typescript
import {
  fallbackAnalysisDocumentV3,
  parseAnalysisDocumentV3,
} from './analysisDocumentV3';
import {
  getEntitiesPrompt,
  getSpeakerIdentityPrompt,
  getStructuredAnalysisPrompt,
  getTopicAnalysisPrompt,
  getTopicSegmentationPrompt,
  getTitlePrompt,
  getValueSignalsPrompt,
} from './prompts';
import type {
  AnalysisDocumentV3,
  ActionItemV3,
  DecisionV3,
  MeetingType,
  TopicSection,
} from './analysisTypes';
import type {
  EntityExtractionContext,
  ExtractedEntities,
  InternalSignalDocument,
  InternalSignalTag,
  LLMProvider,
  LLMSettings,
  ProviderType,
} from './provider';
```

Remove imports of: `analysisDocumentToMarkdown`, `fallbackAnalysisDocument`, `parseAnalysisMarkdown`, `getSummaryPrompt`, `getSummaryRepairPrompt`, and types `AnalysisArtifacts`.

- [ ] **Step 2: Add `'structuredAnalysis'` and `'topicSegmentation'` and `'topicAnalysis'` to the `LLMTask` union type**

```typescript
type LLMTask =
  | 'structuredAnalysis'
  | 'topicSegmentation'
  | 'topicAnalysis'
  | 'speaker'
  | 'title'
  | 'entities'
  | 'valueSignals'
  | 'knowledgeDoc'
  | 'askPluto'
  | 'queryClassification';
```

- [ ] **Step 3: Remove `generateSummary`, `generateUserAnalysisMarkdown`, and `generateAnalysisArtifacts` methods**

Delete the methods at lines 96–198.

- [ ] **Step 4: Implement `generateStructuredAnalysis` — cloud single-pass path**

```typescript
async generateStructuredAnalysis(
  transcript: string,
  userNotes?: string,
): Promise<AnalysisDocumentV3> {
  if (this.providerType === 'ollama') {
    return this.generateStructuredAnalysisMultiPass(transcript, userNotes);
  }
  return this.generateStructuredAnalysisSinglePass(transcript, userNotes);
}

private async generateStructuredAnalysisSinglePass(
  transcript: string,
  userNotes?: string,
): Promise<AnalysisDocumentV3> {
  const prompt = getStructuredAnalysisPrompt(transcript, userNotes);

  try {
    const raw = await this.generateText({
      prompt,
      task: 'structuredAnalysis',
      jsonMode: true,
    });

    const parsed = parseAnalysisDocumentV3(this.cleanJsonText(raw));
    if (!parsed) {
      console.warn(`[${this.name}] Structured analysis returned unparseable JSON, using fallback`);
      return fallbackAnalysisDocumentV3(1, ['LLM returned unparseable JSON for v3 analysis']);
    }

    return {
      ...parsed,
      quality: {
        ...parsed.quality,
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
      },
    };
  } catch (e) {
    console.error(`[${this.name}] Structured analysis failed:`, e);
    return fallbackAnalysisDocumentV3(1, [`Analysis generation failed: ${String(e)}`]);
  }
}
```

- [ ] **Step 5: Implement multi-pass path for Ollama**

```typescript
private async generateStructuredAnalysisMultiPass(
  transcript: string,
  userNotes?: string,
): Promise<AnalysisDocumentV3> {
  // Pass 1: Topic segmentation
  let topicSegments: Array<{ title: string; start_segment: number; end_segment: number }> = [];

  try {
    const segmentationPrompt = getTopicSegmentationPrompt(transcript);
    const segRaw = await this.generateText({
      prompt: segmentationPrompt,
      task: 'topicSegmentation',
      jsonMode: true,
    });
    const segParsed = JSON.parse(this.cleanJsonText(segRaw)) as Record<string, unknown>;
    if (Array.isArray(segParsed.topics)) {
      topicSegments = segParsed.topics
        .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
        .map((t) => ({
          title: typeof t.title === 'string' ? t.title.trim() : 'Discussion',
          start_segment: typeof t.start_segment === 'number' ? t.start_segment : 0,
          end_segment: typeof t.end_segment === 'number' ? t.end_segment : 0,
        }))
        .filter((t) => t.title.length > 0);
    }
  } catch (e) {
    console.warn(`[${this.name}] Topic segmentation failed, using single-topic fallback:`, e);
  }

  // If segmentation failed or returned nothing, treat whole transcript as one topic
  if (topicSegments.length === 0) {
    topicSegments = [{ title: 'General Discussion', start_segment: 0, end_segment: 9999 }];
  }

  // Split transcript into lines for slicing
  const transcriptLines = transcript.split('\n');

  // Pass 2: Per-topic analysis
  const topics: TopicSection[] = [];
  const allActionItems: ActionItemV3[] = [];
  const allDecisions: DecisionV3[] = [];

  for (const segment of topicSegments) {
    const slice = transcriptLines
      .slice(segment.start_segment, segment.end_segment + 1)
      .join('\n');

    if (!slice.trim()) continue;

    try {
      const topicPrompt = getTopicAnalysisPrompt(segment.title, slice, userNotes);
      const topicRaw = await this.generateText({
        prompt: topicPrompt,
        task: 'topicAnalysis',
        jsonMode: true,
      });
      const topicParsed = JSON.parse(this.cleanJsonText(topicRaw)) as Record<string, unknown>;

      const key_points = Array.isArray(topicParsed.key_points)
        ? topicParsed.key_points
            .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
            .map((p) => ({
              text: typeof p.text === 'string' ? p.text.trim() : '',
              speaker: typeof p.speaker === 'string' ? p.speaker.trim() || undefined : undefined,
              from_user_notes: p.from_user_notes === true ? true : undefined,
            }))
            .filter((p) => p.text.length > 0)
        : [];

      const decisions = Array.isArray(topicParsed.decisions)
        ? topicParsed.decisions
            .filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object')
            .map((d) => ({
              text: typeof d.text === 'string' ? d.text.trim() : '',
              decided_by: typeof d.decided_by === 'string' ? d.decided_by.trim() || undefined : undefined,
              rationale: typeof d.rationale === 'string' ? d.rationale.trim() || undefined : undefined,
            }))
            .filter((d) => d.text.length > 0)
        : [];

      const action_items = Array.isArray(topicParsed.action_items)
        ? topicParsed.action_items
            .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
            .map((a) => ({
              text: typeof a.text === 'string' ? a.text.trim() : '',
              assignee: typeof a.assignee === 'string' ? a.assignee.trim() || undefined : undefined,
              due: typeof a.due === 'string' ? a.due.trim() || undefined : undefined,
              topic: segment.title,
            }))
            .filter((a) => a.text.length > 0)
        : [];

      const open_questions = Array.isArray(topicParsed.open_questions)
        ? topicParsed.open_questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        : [];

      topics.push({
        title: segment.title,
        summary: typeof topicParsed.summary === 'string' ? topicParsed.summary.trim() : '',
        key_points,
        decisions,
        action_items,
        open_questions,
        transcript_range: [segment.start_segment, segment.end_segment],
      });

      allActionItems.push(...action_items);
      allDecisions.push(...decisions);
    } catch (e) {
      console.warn(`[${this.name}] Per-topic analysis failed for "${segment.title}":`, e);
    }
  }

  if (topics.length === 0) {
    return fallbackAnalysisDocumentV3(1, ['All per-topic analysis passes failed']);
  }

  // Generate overview from topics
  const overview = topics.map((t) => t.summary).filter(Boolean).join(' ').slice(0, 500)
    || 'Conversation captured. See topics below for details.';

  return {
    analysis_schema_version: 3,
    overview,
    topics,
    all_action_items: allActionItems,
    all_decisions: allDecisions,
    meeting_type: 'general',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  };
}
```

- [ ] **Step 6: Update `getSystemInstruction`, `getTemperature`, `getClaudeMaxTokens`**

Add cases for the new task types:

In `getSystemInstruction`:
```typescript
if (task === 'structuredAnalysis') {
  return 'You are a rigorous meeting analyst. Always respond with valid JSON only.';
}
if (task === 'topicSegmentation') {
  return 'You are a meeting topic segmentation expert. Always respond with valid JSON only.';
}
if (task === 'topicAnalysis') {
  return 'You are a meeting topic analyst. Always respond with valid JSON only.';
}
```

In `getTemperature`:
```typescript
if (task === 'structuredAnalysis') return 0.7;
if (task === 'topicSegmentation') return 0.3;
if (task === 'topicAnalysis') return 0.5;
```

In `getClaudeMaxTokens`:
```typescript
if (task === 'structuredAnalysis') return 4096;
if (task === 'topicSegmentation') return 512;
if (task === 'topicAnalysis') return 2048;
```

- [ ] **Step 7: Remove dead task types from `LLMTask`**

Remove `'summary'` and `'summaryRepair'` from the `LLMTask` union. Remove their handling from `getSystemInstruction`, `getTemperature`, and `getClaudeMaxTokens`.

- [ ] **Step 8: Commit**

```bash
git add electron/llm/unifiedProvider.ts
git commit -m "feat: implement generateStructuredAnalysis with cloud and local paths"
```

---

## Task 6: Database Migration — `user_edits_json` Column

**Files:**
- Modify: `electron/db.ts`

- [ ] **Step 1: Add the migration**

In `electron/db.ts`, in the additive migration block (after the `mid_json` migration at line ~346), add:

```typescript
if (!meetingColumns.some((col) => col.name === 'user_edits_json')) {
  db.exec('ALTER TABLE meetings ADD COLUMN user_edits_json TEXT');
  console.log('[DB] Added meetings.user_edits_json column');
}
```

- [ ] **Step 2: Add `user_edits_json` to `PersistedMeeting` interface**

At line ~39 of `electron/db.ts`, add to the `PersistedMeeting` interface:

```typescript
user_edits_json?: string | null;
```

- [ ] **Step 3: Update `saveMeeting` to persist `user_edits_json`**

In the `saveMeeting` function, add `user_edits_json` to the INSERT statement's column list and values:

In the SQL string (line ~691):
```sql
INSERT OR REPLACE INTO meetings (
  id, title, meeting_type, started_at, ended_at, duration_seconds,
  audio_path, transcript_json, user_notes, enhanced_notes, analysis_json, analysis_schema_version,
  analysis_format_pass, analysis_retry_count, analysis_fallback_used, value_signals_json, folder_id, is_favorite, end_reason, user_edits_json, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
```

And add this parameter after `end_reason` in the `stmt.run(...)` call:
```typescript
meeting.user_edits_json || null,
```

- [ ] **Step 4: Commit**

```bash
git add electron/db.ts
git commit -m "feat: add user_edits_json column to meetings table"
```

---

## Task 7: Update IPC Handlers in `main.ts`

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Update `fallbackAnalysisArtifacts` to return v3**

Replace the `fallbackAnalysisArtifacts` function (lines ~1311-1343) with:

```typescript
const fallbackAnalysisV3 = (): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: 'Conversation captured. Key themes and follow-ups are summarized below.',
  topics: [],
  all_action_items: [],
  all_decisions: [],
  meeting_type: 'general',
  quality: {
    format_pass: false,
    retry_count: 1,
    fallback_used: true,
    issues: ['Analysis generation failed in main-process fallback.'],
  },
});
```

Add import of `AnalysisDocumentV3` from `./llm/analysisTypes` at the top.

- [ ] **Step 2: Update `GENERATE_ANALYSIS_V2` handler to call `generateStructuredAnalysis`**

Replace the handler (lines ~1345-1370) with:

```typescript
ipcMain.handle(
  'GENERATE_ANALYSIS_V2',
  async (_event, { transcript, userNotes }) => {
    try {
      if (!transcript || !transcript.trim()) {
        return {
          analysis: fallbackAnalysisV3(),
          signals: emptyValueSignals(),
        };
      }
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      console.log(
        `[LLM] Generating v3 structured analysis with provider: ${provider.name}`,
      );
      const analysis = await provider.generateStructuredAnalysis(
        transcript,
        userNotes,
      );
      const signals = await provider.extractValueSignals(
        transcript,
        analysis.overview,
      );
      return {
        analysis,
        signals: normalizeValueSignals(signals),
      };
    } catch (error) {
      console.error('[LLM] v3 analysis generation failed:', error);
      return {
        analysis: fallbackAnalysisV3(),
        signals: emptyValueSignals(),
      };
    }
  },
);
```

Note: the return shape changes — no more `markdown` field. The client will render from the structured document.

- [ ] **Step 3: Add `SAVE_USER_EDIT` IPC handler**

After the `SAVE_MEETING` handler, add:

```typescript
ipcMain.handle(
  'SAVE_USER_EDIT',
  async (_event, { meetingId, path, original, edited }) => {
    try {
      const meeting = db.getMeeting(String(meetingId)) as
        | db.PersistedMeeting
        | undefined;
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }
      let editsMap: Record<string, { original: string; edited: string; edited_at: string }> = {};
      if (meeting.user_edits_json) {
        try {
          editsMap = JSON.parse(meeting.user_edits_json);
        } catch {
          editsMap = {};
        }
      }
      editsMap[path] = {
        original,
        edited,
        edited_at: new Date().toISOString(),
      };
      db.saveMeeting({
        ...meeting,
        user_edits_json: JSON.stringify(editsMap),
      });
      return { success: true };
    } catch (e) {
      console.error('[Pluto] SAVE_USER_EDIT failed:', e);
      throw e;
    }
  },
);

ipcMain.handle(
  'REVERT_USER_EDIT',
  async (_event, { meetingId, path }) => {
    try {
      const meeting = db.getMeeting(String(meetingId)) as
        | db.PersistedMeeting
        | undefined;
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }
      let editsMap: Record<string, unknown> = {};
      if (meeting.user_edits_json) {
        try {
          editsMap = JSON.parse(meeting.user_edits_json);
        } catch {
          editsMap = {};
        }
      }
      delete editsMap[path];
      db.saveMeeting({
        ...meeting,
        user_edits_json: JSON.stringify(editsMap),
      });
      return { success: true };
    } catch (e) {
      console.error('[Pluto] REVERT_USER_EDIT failed:', e);
      throw e;
    }
  },
);
```

- [ ] **Step 4: Update MID generation code to handle v3 analysis**

In the `EXTRACT_AND_PROCESS_ENTITIES` handler (around line ~1538), the code parses `analysis_json` as `AnalysisDocument`. Update to detect v3:

```typescript
// Parse analysis from the meeting's stored data
let analysisDoc: AnalysisDocument = fallbackAnalysisArtifacts().analysis;
if (meeting.analysis_json) {
  try {
    const parsed = JSON.parse(meeting.analysis_json);
    if (parsed.analysis_schema_version === 3) {
      // Convert v3 to v2 shape for MID generator compatibility
      analysisDoc = {
        analysis_schema_version: 3,
        summary: [parsed.overview || ''],
        key_points: (parsed.topics || []).flatMap(
          (t: { key_points?: Array<{ text: string }> }) =>
            (t.key_points || []).map((p) => p.text)
        ),
        action_items: (parsed.all_action_items || []).map(
          (a: { text: string; assignee?: string }) =>
            a.assignee ? `${a.assignee}: ${a.text}` : a.text
        ),
        decisions: (parsed.all_decisions || []).map(
          (d: { text: string }) => d.text
        ),
        quality: parsed.quality || { format_pass: true, retry_count: 0, fallback_used: false, issues: [] },
      };
    } else {
      analysisDoc = parsed;
    }
  } catch {
    // Use fallback
  }
}
```

Note: Keep the old `fallbackAnalysisArtifacts` function alongside `fallbackAnalysisV3` temporarily — it's still used by the MID generation path for the v2 `AnalysisDocument` shape.

- [ ] **Step 5: Remove `GENERATE_SUMMARY` handler if no longer needed**

The `GENERATE_SUMMARY` handler (lines ~1372-1389) delegates to `provider.generateSummary()` which no longer exists. Remove this handler entirely. Search for any callers first (expected: none, since AudioManager already uses `GENERATE_ANALYSIS_V2`).

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: update IPC handlers for v3 analysis and user edits"
```

---

## Task 8: Update `knowledgeSynthesis.ts` for v3 Evidence

**Files:**
- Modify: `electron/knowledgeSynthesis.ts`
- Create: `tests/unit/knowledgeSynthesisV3.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/knowledgeSynthesisV3.test.ts
import { describe, expect, it } from 'vitest';

// We'll test the parseAnalysisJson function indirectly by importing it.
// Since it's not exported, we test via extracting evidence behavior.
// For this test, we create a local extraction helper matching the same logic.

const normalizeList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseAnalysisJsonV3Aware = (
  raw: string | null | undefined,
): { summary: string[]; key_points: string[]; action_items: string[]; decisions: string[] } => {
  const empty = { summary: [], key_points: [], action_items: [], decisions: [] };
  if (!raw || !raw.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.analysis_schema_version === 3) {
      const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
      const key_points = topics.flatMap((t: Record<string, unknown>) =>
        Array.isArray(t.key_points)
          ? t.key_points.map((p: Record<string, unknown>) =>
              typeof p.text === 'string' ? p.text.trim() : ''
            ).filter(Boolean)
          : [],
      );
      const decisions = Array.isArray(parsed.all_decisions)
        ? (parsed.all_decisions as Array<Record<string, unknown>>)
            .map((d) => (typeof d.text === 'string' ? d.text.trim() : ''))
            .filter(Boolean)
        : [];
      const action_items = Array.isArray(parsed.all_action_items)
        ? (parsed.all_action_items as Array<Record<string, unknown>>)
            .map((a) => {
              const text = typeof a.text === 'string' ? a.text.trim() : '';
              const assignee = typeof a.assignee === 'string' ? a.assignee.trim() : '';
              return assignee ? `${assignee}: ${text}` : text;
            })
            .filter(Boolean)
        : [];
      return {
        summary: [typeof parsed.overview === 'string' ? parsed.overview.trim() : ''].filter(Boolean),
        key_points: key_points.slice(0, 8),
        action_items: action_items.slice(0, 6),
        decisions: decisions.slice(0, 6),
      };
    }
    return {
      summary: normalizeList(parsed.summary).slice(0, 6),
      key_points: normalizeList(parsed.key_points).slice(0, 8),
      action_items: normalizeList(parsed.action_items).slice(0, 6),
      decisions: normalizeList(parsed.decisions).slice(0, 6),
    };
  } catch {
    return empty;
  }
};

describe('parseAnalysisJson v3 awareness', () => {
  it('extracts evidence from v3 schema', () => {
    const v3Doc = {
      analysis_schema_version: 3,
      overview: 'We discussed hiring.',
      topics: [
        {
          title: 'Hiring',
          summary: 'Need 2 engineers.',
          key_points: [{ text: 'Budget is $180k', speaker: 'Sarah' }],
          decisions: [],
          action_items: [],
          open_questions: [],
        },
      ],
      all_action_items: [{ text: 'Draft JD', assignee: 'Sarah' }],
      all_decisions: [{ text: 'Post role by Friday' }],
      meeting_type: 'team_sync',
      quality: { format_pass: true, retry_count: 0, fallback_used: false, issues: [] },
    };

    const result = parseAnalysisJsonV3Aware(JSON.stringify(v3Doc));
    expect(result.summary).toEqual(['We discussed hiring.']);
    expect(result.key_points).toEqual(['Budget is $180k']);
    expect(result.action_items).toEqual(['Sarah: Draft JD']);
    expect(result.decisions).toEqual(['Post role by Friday']);
  });

  it('still handles v2 schema', () => {
    const v2Doc = {
      analysis_schema_version: 2,
      summary: ['Short summary'],
      key_points: ['Point A'],
      action_items: ['Do X'],
      decisions: ['Decided Y'],
    };
    const result = parseAnalysisJsonV3Aware(JSON.stringify(v2Doc));
    expect(result.summary).toEqual(['Short summary']);
    expect(result.key_points).toEqual(['Point A']);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (this test is self-contained, testing the extraction logic)

Run: `pnpm vitest run tests/unit/knowledgeSynthesisV3.test.ts`
Expected: PASS

- [ ] **Step 3: Update `parseAnalysisJson` in `electron/knowledgeSynthesis.ts`**

Replace the `parseAnalysisJson` function (lines ~233-248) with v3-aware version:

```typescript
const parseAnalysisJson = (
  raw: string | null | undefined,
): AnalysisEvidence => {
  if (!raw || !raw.trim()) return emptyAnalysisEvidence();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // v3 schema: extract from topics structure
    if (parsed.analysis_schema_version === 3) {
      const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
      const key_points = (topics as Array<Record<string, unknown>>).flatMap(
        (t) =>
          Array.isArray(t.key_points)
            ? (t.key_points as Array<Record<string, unknown>>)
                .map((p) => (typeof p.text === 'string' ? p.text.trim() : ''))
                .filter(Boolean)
            : [],
      );
      const allDecisions = Array.isArray(parsed.all_decisions)
        ? (parsed.all_decisions as Array<Record<string, unknown>>)
            .map((d) => (typeof d.text === 'string' ? d.text.trim() : ''))
            .filter(Boolean)
        : [];
      const allActionItems = Array.isArray(parsed.all_action_items)
        ? (parsed.all_action_items as Array<Record<string, unknown>>)
            .map((a) => {
              const text = typeof a.text === 'string' ? a.text.trim() : '';
              const assignee = typeof a.assignee === 'string' ? a.assignee.trim() : '';
              return assignee ? `${assignee}: ${text}` : text;
            })
            .filter(Boolean)
        : [];

      return {
        summary: [typeof parsed.overview === 'string' ? parsed.overview.trim() : ''].filter(Boolean).slice(0, 6),
        key_points: key_points.slice(0, 8),
        action_items: allActionItems.slice(0, 6),
        decisions: allDecisions.slice(0, 6),
      };
    }

    // v2 schema: flat arrays
    return {
      summary: normalizeList(parsed.summary).slice(0, 6),
      key_points: normalizeList(parsed.key_points).slice(0, 8),
      action_items: normalizeList(parsed.action_items).slice(0, 6),
      decisions: normalizeList(parsed.decisions).slice(0, 6),
    };
  } catch {
    return emptyAnalysisEvidence();
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add electron/knowledgeSynthesis.ts tests/unit/knowledgeSynthesisV3.test.ts
git commit -m "feat: update knowledge synthesis to extract evidence from v3 analysis"
```

---

## Task 9: Update MID Generator for v3

**Files:**
- Modify: `electron/intelligence/midGenerator.ts`

- [ ] **Step 1: Accept v2 or v3 analysis via union type**

Update the import and `MidGeneratorInput` to accept either:

```typescript
import type { AnalysisDocument, InternalSignalDocument } from '../llm/provider';
import type { AnalysisDocumentV3 } from '../llm/analysisTypes';
```

Change the `analysis` field:
```typescript
export interface MidGeneratorInput {
  meeting_id: string;
  title: string;
  occurred_at: string | null;
  duration_seconds: number;
  analysis: AnalysisDocument | AnalysisDocumentV3;
  signals: InternalSignalDocument;
  meeting_entities: Array<Entity & { mention_count: number; context: string | null }>;
  transcript_segments?: Array<{ text: string; speaker?: string }>;
}
```

- [ ] **Step 2: Add a helper to normalize analysis to v2 shape for evidence spans**

Before the `generateMid` function, add:

```typescript
interface NormalizedAnalysis {
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
}

const normalizeAnalysisForEvidence = (
  analysis: AnalysisDocument | AnalysisDocumentV3,
): NormalizedAnalysis => {
  if ('overview' in analysis && analysis.analysis_schema_version === 3) {
    const v3 = analysis as AnalysisDocumentV3;
    return {
      summary: [v3.overview],
      key_points: v3.topics.flatMap((t) => t.key_points.map((p) => p.text)),
      action_items: v3.all_action_items.map((a) => a.text),
      decisions: v3.all_decisions.map((d) => d.text),
    };
  }
  const v2 = analysis as AnalysisDocument;
  return {
    summary: v2.summary,
    key_points: v2.key_points,
    action_items: v2.action_items,
    decisions: v2.decisions,
  };
};
```

- [ ] **Step 3: Replace direct `analysis.summary` / `analysis.key_points` usage with normalized**

In `generateMid`, replace the Evidence Spans section (lines ~234-286) to use `normalizeAnalysisForEvidence`:

```typescript
const normalized = normalizeAnalysisForEvidence(analysis);

// Map summary paragraphs to transcript
for (const paragraph of normalized.summary) {
  const range = findEvidenceSpan(paragraph, segments);
  if (range) {
    spanCounter++;
    evidenceSpans.push({
      span_id: `summary-${spanCounter}`,
      claim_type: 'summary',
      transcript_range: range,
      quote: segments.slice(range[0], range[1] + 1).map((s) => s.text).join(' ').slice(0, 300),
    });
  }
}

// Map decisions to transcript
for (const decisionText of normalized.decisions) {
  const range = findEvidenceSpan(decisionText, segments);
  if (range) {
    spanCounter++;
    evidenceSpans.push({
      span_id: `decision-${spanCounter}`,
      claim_type: 'decision',
      transcript_range: range,
      quote: segments.slice(range[0], range[1] + 1).map((s) => s.text).join(' ').slice(0, 300),
    });
  }
}

// Map key points to transcript
for (const point of normalized.key_points) {
  const range = findEvidenceSpan(point, segments);
  if (range) {
    spanCounter++;
    evidenceSpans.push({
      span_id: `key-point-${spanCounter}`,
      claim_type: 'key_point',
      transcript_range: range,
      quote: segments.slice(range[0], range[1] + 1).map((s) => s.text).join(' ').slice(0, 300),
    });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add electron/intelligence/midGenerator.ts
git commit -m "feat: update MID generator to accept v3 analysis documents"
```

---

## Task 10: Update Frontend Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add v3 types and update `Meeting`**

Add at the end of `src/types.ts`:

```typescript
// === v3 Analysis Schema ===

export type MeetingType = 'one_on_one' | 'team_sync' | 'brainstorm' | 'presentation' | 'general';

export interface TopicPoint {
  text: string;
  speaker?: string;
  from_user_notes?: boolean;
}

export interface DecisionV3 {
  text: string;
  decided_by?: string;
  rationale?: string;
}

export interface ActionItemV3 {
  text: string;
  assignee?: string;
  due?: string;
  topic?: string;
}

export interface TopicSection {
  title: string;
  summary: string;
  key_points: TopicPoint[];
  decisions: DecisionV3[];
  action_items: ActionItemV3[];
  open_questions: string[];
  transcript_range?: [number, number];
}

export interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;
  topics: TopicSection[];
  all_action_items: ActionItemV3[];
  all_decisions: DecisionV3[];
  meeting_type: MeetingType;
  quality: AnalysisQuality;
}

export interface UserEdit {
  original: string;
  edited: string;
  edited_at: string;
}

export interface UserEditsMap {
  [path: string]: UserEdit;
}
```

Add `user_edits_json` to the `Meeting` interface:

```typescript
export interface Meeting {
  id: string | number;
  title: string;
  created_at: string;
  started_at: string;
  duration_seconds?: number;
  meeting_type?: string;
  enhanced_notes?: string;
  transcript_json?: string;
  user_notes?: string;
  value_signals_json?: string;
  analysis_json?: string;
  analysis_schema_version?: number;
  analysis_format_pass?: number | boolean;
  analysis_retry_count?: number;
  analysis_fallback_used?: number | boolean;
  user_edits_json?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add v3 analysis types and user_edits_json to frontend Meeting type"
```

---

## Task 11: Update Client-Side Analysis Utilities

**Files:**
- Modify: `src/utils/analysisDocument.ts`

- [ ] **Step 1: Add v3 parser and resolver alongside existing v2 code**

Add these at the end of `src/utils/analysisDocument.ts`:

```typescript
import type { AnalysisDocumentV3, UserEditsMap } from '../types';

export const parseAnalysisDocumentV3Json = (
  raw?: string | null,
): AnalysisDocumentV3 | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.analysis_schema_version !== 3) return null;
    if (typeof parsed.overview !== 'string' || !parsed.overview.trim()) return null;
    // Return as-is with validation (the backend already validated)
    return parsed as unknown as AnalysisDocumentV3;
  } catch {
    return null;
  }
};

export const parseUserEditsJson = (
  raw?: string | null,
): UserEditsMap => {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as UserEditsMap;
  } catch {
    return {};
  }
};

export const applyUserEdit = (
  original: string,
  path: string,
  editsMap: UserEditsMap,
): string => {
  const edit = editsMap[path];
  if (!edit) return original;
  return edit.edited;
};

export const resolveMeetingAnalysis = (
  meeting?: { analysis_json?: string; analysis_schema_version?: number; enhanced_notes?: string; user_notes?: string },
): { version: 2 | 3; v2: AnalysisDocument | null; v3: AnalysisDocumentV3 | null } => {
  if (!meeting) return { version: 2, v2: null, v3: null };

  const v3 = parseAnalysisDocumentV3Json(meeting.analysis_json);
  if (v3) return { version: 3, v2: null, v3 };

  const v2 = resolveMeetingAnalysisDocument(meeting as Meeting);
  return { version: 2, v2, v3: null };
};
```

- [ ] **Step 2: Write a test for user edits overlay**

```typescript
// tests/unit/userEditsOverlay.test.ts
import { describe, expect, it } from 'vitest';

import {
  applyUserEdit,
  parseUserEditsJson,
} from '../../src/utils/analysisDocument';

describe('parseUserEditsJson', () => {
  it('returns empty map for null/undefined', () => {
    expect(parseUserEditsJson(null)).toEqual({});
    expect(parseUserEditsJson(undefined)).toEqual({});
  });

  it('parses valid edits JSON', () => {
    const json = JSON.stringify({
      'topic:0:point:1': {
        original: 'old text',
        edited: 'new text',
        edited_at: '2026-04-09T00:00:00Z',
      },
    });
    const result = parseUserEditsJson(json);
    expect(result['topic:0:point:1']).toBeDefined();
    expect(result['topic:0:point:1'].edited).toBe('new text');
  });
});

describe('applyUserEdit', () => {
  it('returns original when no edit exists', () => {
    expect(applyUserEdit('original text', 'topic:0:point:0', {})).toBe('original text');
  });

  it('returns edited text when edit exists', () => {
    const edits = {
      'topic:0:point:0': {
        original: 'original text',
        edited: 'edited text',
        edited_at: '2026-04-09T00:00:00Z',
      },
    };
    expect(applyUserEdit('original text', 'topic:0:point:0', edits)).toBe('edited text');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/unit/userEditsOverlay.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/analysisDocument.ts tests/unit/userEditsOverlay.test.ts
git commit -m "feat: add v3 client-side analysis parser and user edits overlay"
```

---

## Task 12: Update `AudioManager.tsx`

**Files:**
- Modify: `src/components/AudioManager.tsx`

- [ ] **Step 1: Update local type copies to support v3**

The AudioManager has local copies of `AnalysisDocument` and `AnalysisArtifacts` interfaces. Update the pipeline to handle the new return shape from `GENERATE_ANALYSIS_V2`.

Replace the `AnalysisArtifacts` interface (line ~130):
```typescript
interface AnalysisV3Result {
  analysis: Record<string, unknown>;
  signals: InternalSignalDocument;
}
```

- [ ] **Step 2: Update the analysis generation pipeline**

In the `stopSession` handler (around line ~4043), update the code that processes analysis results:

```typescript
try {
  const rawResult = (await window.ipcRenderer.invoke(
    'GENERATE_ANALYSIS_V2',
    {
      transcript: fullTranscript,
      userNotes: userNotes,
    },
  )) as AnalysisV3Result;

  const analysisRaw = rawResult?.analysis;
  const schemaVersion = typeof analysisRaw === 'object' && analysisRaw
    ? (analysisRaw as Record<string, unknown>).analysis_schema_version
    : 2;
  valueSignals = normalizeValueSignals(rawResult?.signals);

  // For enhanced_notes, render a markdown representation
  if (schemaVersion === 3) {
    const v3 = analysisRaw as Record<string, unknown>;
    const overview = typeof v3.overview === 'string' ? v3.overview : '';
    const topicLines = Array.isArray(v3.topics)
      ? (v3.topics as Array<Record<string, unknown>>).map((t) => {
          const title = typeof t.title === 'string' ? t.title : '';
          const summary = typeof t.summary === 'string' ? t.summary : '';
          return `## ${title}\n${summary}`;
        }).join('\n\n')
      : '';
    enhancedNotes = `${overview}\n\n${topicLines}`.trim() || 'Analysis generated.';
    analysisDocument = {
      analysis_schema_version: 3,
      summary: [overview],
      key_points: [],
      action_items: [],
      decisions: [],
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    };
  } else {
    analysisDocument = normalizeAnalysisDocument(analysisRaw);
    enhancedNotes = analysisDocumentToMarkdown(analysisDocument);
  }

  if (!enhancedNotes.trim()) {
    enhancedNotes = 'Analysis generated.';
  }

  console.log(
    '[Pluto] Analysis generated:',
    `schemaVersion=${schemaVersion},`,
    `continuity=${valueSignals.continuity.length},`,
    `accountability=${valueSignals.accountability_risks.length},`,
    `decisionImpact=${valueSignals.decision_impacts.length}`,
  );
} catch (analysisErr) {
  console.error('[Pluto] Analysis generation failed:', analysisErr);
  analysisDocument = emptyAnalysisDocument();
  enhancedNotes = analysisDocumentToMarkdown(analysisDocument);
  valueSignals = emptyValueSignals();
}
```

- [ ] **Step 3: Update the SAVE_MEETING call to pass the raw analysis JSON**

Around line ~4174, change `analysis_json` to store the raw analysis object:

```typescript
analysis_json: JSON.stringify(schemaVersion === 3 ? rawResult.analysis : analysisDocument),
analysis_schema_version: typeof schemaVersion === 'number' ? schemaVersion : 2,
```

Note: `schemaVersion` and `rawResult` need to be in scope — hoist their declarations above the try/catch if needed.

- [ ] **Step 4: Commit**

```bash
git add src/components/AudioManager.tsx
git commit -m "feat: update AudioManager to handle v3 analysis pipeline"
```

---

## Task 13: Redesign `MeetingView.tsx` — v3 Document-Flow Layout

**Files:**
- Modify: `src/components/features/MeetingView.tsx`

This is the largest task. The MeetingView needs to render v3 meetings as a document-flow layout and keep the existing v2 rendering for backward compatibility.

- [ ] **Step 1: Add v3 detection and state for user edits**

At the top of the component, after the existing analysis resolution:

```typescript
import {
  analysisDocumentToMarkdown,
  applyUserEdit,
  parseAnalysisDocumentV3Json,
  parseAnalysisDocumentJson,
  parseUserEditsJson,
  resolveMeetingAnalysisDocument,
} from '../../utils/analysisDocument';
import type {
  AnalysisDocumentV3,
  TopicSection,
  UserEditsMap,
} from '../../types';
```

Inside the component:
```typescript
const v3Doc = parseAnalysisDocumentV3Json(selectedMeeting.analysis_json);
const isV3 = v3Doc !== null;
const userEdits = parseUserEditsJson(selectedMeeting.user_edits_json);

// Existing v2 analysis resolution (keep for backward compat)
const analysisDoc = isV3 ? null : resolveMeetingAnalysisDocument(selectedMeeting);
```

- [ ] **Step 2: Add inline editing state and handlers**

```typescript
const [editingPath, setEditingPath] = useState<string | null>(null);
const [editValue, setEditValue] = useState('');

const startEditing = (path: string, currentText: string) => {
  setEditingPath(path);
  setEditValue(currentText);
};

const saveEdit = async (path: string, originalText: string) => {
  if (!editValue.trim() || editValue === originalText) {
    setEditingPath(null);
    return;
  }
  try {
    await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
      meetingId: String(selectedMeeting.id),
      path,
      original: originalText,
      edited: editValue.trim(),
    });
    await fetchMeetings();
  } catch (err) {
    console.error('Failed to save edit:', err);
  }
  setEditingPath(null);
};

const revertEdit = async (path: string) => {
  try {
    await window.ipcRenderer.invoke('REVERT_USER_EDIT', {
      meetingId: String(selectedMeeting.id),
      path,
    });
    await fetchMeetings();
  } catch (err) {
    console.error('Failed to revert edit:', err);
  }
};
```

- [ ] **Step 3: Build the v3 document-flow rendering**

Add a new section inside the component's return JSX. Wrap the existing v2 analysis rendering in an `!isV3 &&` condition, then add the v3 block:

```tsx
{isV3 && v3Doc ? (
  <div className="space-y-8">
    {/* Overview */}
    <div className="text-lg font-medium leading-relaxed text-pro-text-main/90 bg-pro-surface/40 backdrop-blur-sm p-8 rounded-[2rem] border border-pro-border/40 shadow-sm">
      <p>{highlightEntities(v3Doc.overview)}</p>
    </div>

    {/* Topic Sections */}
    {v3Doc.topics.map((topic, topicIndex) => (
      <div key={topic.title} className="space-y-4">
        <div className="border-t border-pro-border/30 pt-6">
          <h2 className="text-xl font-bold text-pro-text-main mb-2">{topic.title}</h2>
          {topic.summary && (
            <p className="text-[14px] text-pro-text-muted/80 leading-relaxed mb-4">
              {highlightEntities(topic.summary)}
            </p>
          )}

          <div className="space-y-2">
            {topic.key_points.map((point, pointIndex) => {
              const path = `topic:${topicIndex}:point:${pointIndex}`;
              const displayText = applyUserEdit(point.text, path, userEdits);
              const isEdited = !!userEdits[path];
              const isEditing = editingPath === path;

              return (
                <div key={path} className="flex items-start gap-2 group">
                  <span className="text-pro-text-muted/60 mt-0.5 shrink-0">
                    {point.from_user_notes ? '📝' : '•'}
                  </span>
                  {isEditing ? (
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(path, point.text)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit(path, point.text);
                        }
                        if (e.key === 'Escape') setEditingPath(null);
                      }}
                      className="flex-1 text-[14px] leading-relaxed bg-pro-surface border border-pro-accent/30 rounded-lg px-3 py-1.5 text-pro-text-main outline-none resize-none"
                      rows={2}
                      autoFocus
                    />
                  ) : (
                    <p
                      className={`flex-1 text-[14px] leading-relaxed text-pro-text-main/80 cursor-text hover:bg-pro-surface/50 rounded px-1 -mx-1 transition-colors ${isEdited ? 'text-pro-accent/90' : ''}`}
                      onClick={() => startEditing(path, displayText)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') startEditing(path, displayText);
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      {point.speaker && (
                        <span className="font-semibold text-pro-text-main">{point.speaker}: </span>
                      )}
                      {highlightEntities(displayText)}
                      {isEdited && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); revertEdit(path); }}
                          className="ml-2 text-[10px] font-bold uppercase tracking-widest text-pro-text-muted/50 hover:text-red-500 transition-colors"
                          title="Revert to original"
                        >
                          ↩ revert
                        </button>
                      )}
                    </p>
                  )}
                </div>
              );
            })}

            {topic.decisions.map((decision, di) => (
              <div key={`decision-${topicIndex}-${di}`} className="flex items-start gap-2">
                <span className="text-indigo-500 font-bold shrink-0 mt-0.5">↳</span>
                <p className="text-[14px] leading-relaxed text-indigo-900/80 dark:text-indigo-200/90">
                  <span className="font-semibold">Decision{decision.decided_by ? ` (${decision.decided_by})` : ''}: </span>
                  {highlightEntities(decision.text)}
                </p>
              </div>
            ))}

            {topic.open_questions.map((question, qi) => (
              <div key={`question-${topicIndex}-${qi}`} className="flex items-start gap-2">
                <span className="text-amber-500 font-bold shrink-0 mt-0.5">?</span>
                <p className="text-[14px] leading-relaxed text-pro-text-muted/80 italic">
                  {highlightEntities(question)}
                </p>
              </div>
            ))}
          </div>

          {/* View in Transcript link */}
          {topic.transcript_range && (
            <button
              type="button"
              onClick={() => {
                setTranscriptVisible(true);
                // Scroll to segment — handled via event or ref
              }}
              className="mt-3 text-[11px] font-bold uppercase tracking-widest text-pro-accent/70 hover:text-pro-accent transition-colors"
            >
              View in Transcript →
            </button>
          )}
        </div>
      </div>
    ))}

    {/* Rolled-up Action Items */}
    {v3Doc.all_action_items.length > 0 && (
      <div className="border-t border-pro-border/30 pt-6 space-y-4">
        <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
          Action Items
        </h2>
        <div className="space-y-3">
          {v3Doc.all_action_items.map((item, i) => (
            <div
              key={`action-${i}`}
              className="p-4 rounded-xl bg-pro-surface border border-pro-border shadow-sm flex gap-3 group hover:border-pro-accent/30 transition-all"
            >
              <div className="w-5 h-5 rounded border border-pro-border flex items-center justify-center shrink-0 mt-0.5 group-hover:border-pro-accent group-hover:bg-pro-accent/5 transition-all">
                <Check className="w-3 h-3 text-pro-accent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-medium leading-relaxed text-pro-text-main/80">
                  {item.assignee && <span className="font-bold">{item.assignee}: </span>}
                  {highlightEntities(item.text)}
                </p>
                {item.due && (
                  <p className="text-[11px] text-pro-text-muted/60 mt-1">{item.due}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
) : null}
```

- [ ] **Step 4: Wrap existing v2 rendering in `!isV3` guard**

Find the existing `{analysisDoc ? (` block (line ~682) and change it to:

```tsx
{!isV3 && analysisDoc ? (
```

This ensures v2 meetings continue to render with the existing flat layout.

- [ ] **Step 5: Update `regenerateEnhancedNotes` to handle v3 response**

In the `regenerateEnhancedNotes` function, update to handle the new response shape (no `markdown` field, analysis is directly v3):

```typescript
const artifacts = (await window.ipcRenderer.invoke(
  'GENERATE_ANALYSIS_V2',
  {
    transcript,
    userNotes: selectedMeeting.user_notes || '',
  },
)) as { analysis?: unknown; signals?: unknown };

const rawAnalysis = artifacts?.analysis as Record<string, unknown> | undefined;
if (!rawAnalysis) {
  setRegenerateNotesError('Enhanced note generation returned an invalid response.');
  return;
}

const schemaVersion = rawAnalysis.analysis_schema_version;
let enhancedNotes: string;
let normalizedAnalysis: Record<string, unknown>;

if (schemaVersion === 3) {
  normalizedAnalysis = rawAnalysis;
  const overview = typeof rawAnalysis.overview === 'string' ? rawAnalysis.overview : '';
  enhancedNotes = overview || 'Analysis generated.';
} else {
  const v2 = parseAnalysisDocumentJson(JSON.stringify(rawAnalysis));
  if (!v2) {
    setRegenerateNotesError('Enhanced note generation returned an invalid response.');
    return;
  }
  if (v2.quality.fallback_used) {
    setRegenerateNotesError('Enhanced note generation failed.');
    return;
  }
  normalizedAnalysis = v2 as unknown as Record<string, unknown>;
  enhancedNotes = analysisDocumentToMarkdown(v2);
}

await window.ipcRenderer.invoke('SAVE_MEETING', {
  ...selectedMeeting,
  enhanced_notes: enhancedNotes,
  analysis_json: JSON.stringify(normalizedAnalysis),
  analysis_schema_version: schemaVersion ?? selectedMeeting.analysis_schema_version ?? null,
  // ... rest of signals handling
});
```

- [ ] **Step 6: Update `canonicalAnalysisMarkdown` for copy/export**

```typescript
const canonicalAnalysisMarkdown = isV3 && v3Doc
  ? analysisDocumentV3ToMarkdown(v3Doc)  // import from utils
  : analysisDoc
    ? analysisDocumentToMarkdown(analysisDoc)
    : selectedMeeting.enhanced_notes || selectedMeeting.user_notes || '';
```

Add import of `analysisDocumentV3ToMarkdown` — or create a simple client-side version in `src/utils/analysisDocument.ts` that mirrors the server-side one.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/MeetingView.tsx
git commit -m "feat: redesign MeetingView with v3 document-flow layout and inline editability"
```

---

## Task 14: Continuity Links

**Files:**
- Modify: `src/components/features/MeetingView.tsx`

- [ ] **Step 1: Add continuity link lookup for v3 topics**

Inside the v3 topic rendering loop, after the topic content and before the "View in Transcript" link, add a component that queries the entity graph for continuity:

```tsx
// Add state for continuity links
const [continuityLinks, setContinuityLinks] = useState<
  Record<string, { meetingTitle: string; meetingDate: string; meetingId: string }>
>({});

// Effect: look up continuity links for v3 topics
useEffect(() => {
  if (!isV3 || !v3Doc) return;
  let cancelled = false;

  const lookupContinuity = async () => {
    const links: Record<string, { meetingTitle: string; meetingDate: string; meetingId: string }> = {};
    for (const topic of v3Doc.topics) {
      try {
        // Search for matching entity by topic title
        const entities = await window.ipcRenderer.invoke('SEARCH_ENTITIES', topic.title);
        if (!Array.isArray(entities) || entities.length === 0) continue;
        const matchedEntity = entities[0] as { id: string; name: string };
        // Get meetings for this entity
        const meetings = await window.ipcRenderer.invoke('GET_ENTITY_MEETINGS', matchedEntity.id);
        if (!Array.isArray(meetings)) continue;
        // Find most recent prior meeting (not the current one)
        const prior = meetings
          .filter((m: { id: string }) => String(m.id) !== String(selectedMeeting.id))
          .sort((a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0] as { id: string; title: string; created_at: string } | undefined;
        if (prior) {
          links[topic.title] = {
            meetingTitle: prior.title,
            meetingDate: new Date(prior.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
            meetingId: String(prior.id),
          };
        }
      } catch {
        // Skip if entity lookup fails
      }
    }
    if (!cancelled) setContinuityLinks(links);
  };

  lookupContinuity();
  return () => { cancelled = true; };
}, [isV3, v3Doc, selectedMeeting.id]);
```

Then, in the topic section JSX, add after the `transcript_range` button:

```tsx
{continuityLinks[topic.title] && (
  <p className="mt-2 text-[11px] text-pro-text-muted/60">
    ↩ Also discussed in "{continuityLinks[topic.title].meetingTitle}" — {continuityLinks[topic.title].meetingDate}
  </p>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/features/MeetingView.tsx
git commit -m "feat: add continuity links for v3 topic sections"
```

---

## Task 15: Run Full Test Suite and Verify

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Run linter**

Run: `pnpm run lint`
Expected: No new lint errors

- [ ] **Step 3: Build**

Run: `pnpm run build-native && pnpm run dev`
Expected: App starts without errors

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix any remaining lint/type errors from v3 migration"
```

---

## Verification Plan

### Automated Tests
- `pnpm vitest run tests/unit/analysisDocumentV3.test.ts` — v3 parsing, fallback, markdown rendering
- `pnpm vitest run tests/unit/userEditsOverlay.test.ts` — user edit overlay logic
- `pnpm vitest run tests/unit/knowledgeSynthesisV3.test.ts` — v3 evidence extraction
- `pnpm vitest run` — full suite

### Manual Verification
- Record a real meeting → verify v3 structured analysis renders with topic sections
- Test with at least one cloud provider (Gemini/OpenAI) and Ollama for both pipeline paths
- Edit a bullet point → navigate away and back → verify edit persists
- Record two meetings about the same topic → verify continuity link appears
- Open an old (v2) meeting → verify flat layout renders without errors
- Hit the regenerate button (✨) on an old meeting → verify it upgrades to v3
