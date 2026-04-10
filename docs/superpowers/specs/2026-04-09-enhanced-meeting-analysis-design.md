# Enhanced Meeting Analysis — Topic-Structured Notes with Attribution

## Goal

Replace Pluto's flat 4-section meeting analysis (Summary, Key Points, Action Items, Decisions) with a topic-structured document that reads like well-organized meeting notes written by a skilled note-taker. Each discussion topic gets its own section with speaker-attributed points, inline decisions, open questions, and user note integration. Action items roll up into a scannable list at the bottom.

## Background

The current analysis pipeline produces a generic, shallow output regardless of meeting complexity. A 45-minute meeting covering 5 agenda items collapses into the same 2-3 sentence summary as a 10-minute sync. Speaker attribution is lost entirely — you can't tell who raised a concern, who committed to a task, or who made a decision. User notes are passed as context but never surface in the output. The transcript and analysis exist as disconnected views with no cross-referencing.

---

## Analysis Schema v3

### Core Types

```typescript
interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;                        // 2-3 sentence "if you read nothing else"
  topics: TopicSection[];                  // ordered chronologically
  all_action_items: ActionItemV3[];        // rolled up from all topics
  all_decisions: DecisionV3[];             // rolled up from all topics
  meeting_type: MeetingType;
  quality: AnalysisQuality;
}

type MeetingType = 'one_on_one' | 'team_sync' | 'brainstorm' | 'presentation' | 'general';

interface TopicSection {
  title: string;                           // e.g. "Q2 Hiring Plan"
  summary: string;                         // 2-4 sentence digest
  key_points: TopicPoint[];                // speaker-attributed insights
  decisions: DecisionV3[];                 // decisions made under this topic
  action_items: ActionItemV3[];            // tasks from this topic
  open_questions: string[];                // unresolved threads
  transcript_range?: [number, number];     // segment indices for linking
}

interface TopicPoint {
  text: string;
  speaker?: string;                        // "Sarah", "You", null if unclear
  from_user_notes?: boolean;               // true if sourced from user notes
}

interface DecisionV3 {
  text: string;
  decided_by?: string;
  rationale?: string;
}

interface ActionItemV3 {
  text: string;
  assignee?: string;
  due?: string;                            // natural language: "by Friday"
  topic?: string;                          // back-reference to parent topic title
}
```

### Design Decisions

- `topics[]` is ordered chronologically (order of discussion in the meeting).
- Each topic carries its own decisions and action items, but they are also rolled up into `all_action_items` and `all_decisions` for quick scanning and dashboard integration.
- Speaker attribution lives on `TopicPoint.speaker`, `DecisionV3.decided_by`, and `ActionItemV3.assignee` — not on every sentence.
- `transcript_range` links each topic to segment indices, enabling click-to-jump from the analysis to the transcript.
- `open_questions` captures unresolved threads that the current format drops entirely.
- `from_user_notes` on TopicPoint allows the UI to visually distinguish user-contributed context.
- `meeting_type` enables future per-type prompt tuning and UI differentiation.

### Backward Compatibility

The `analysis_schema_version` field already exists in the database. The UI renderer checks this value:
- Version ≤ 2 → render the current flat layout (Summary, Key Points, Action Items, Decisions).
- Version 3 → render the new topic-structured document.

No data migration is needed. Users can hit the regenerate button (✨) to upgrade any old meeting to v3 on demand.

---

## LLM Pipeline

### Cloud Path (Single-Pass)

For cloud providers (`gemini`, `openai`, `claude`), a single structured prompt produces the full v3 document in JSON mode. The prompt instructs the model to:

1. Identify distinct discussion topics from the transcript chronologically.
2. For each topic, produce a summary, speaker-attributed key points, decisions (with who decided), action items (with assignee and due date), and open questions.
3. Map each topic to approximate transcript segment ranges.
4. Weave in user notes — if user notes mention a topic, incorporate them as emphasis/context within that topic's section, marking them with `from_user_notes: true`.
5. Classify the meeting type.
6. Roll up all decisions and action items into the top-level arrays.

The response format uses JSON mode (already supported by all cloud providers in `UnifiedLLMProvider`). This eliminates the current markdown parse → repair → fallback cycle.

**Prompt guardrails** (carried forward from current prompt):
- Use only transcript and user-note details. Never invent facts, owners, decisions, or deadlines.
- Keep technical meaning exact. Do not flip problem/solution, cause/effect, shipped/planned, or agreed/questioned.
- Treat the transcript as source of truth. User notes sharpen emphasis but do not override.
- If discussion is exploratory, say that. Do not convert brainstorming into decisions.
- Distinguish between explicit decisions, proposals/recommendations, and unresolved questions.

**Temperature:** 0.7 (same as current summary task — creative but grounded).

### Local/Small Model Path (Multi-Pass)

For Ollama or weaker models, the pipeline splits into 2 passes:

**Pass 1 — Topic Segmentation:** A focused prompt that reads the transcript and returns `{ topics: [{ title, start_segment, end_segment }] }`. This is a simpler classification task that small models handle well. Temperature: 0.3.

**Pass 2 — Per-Topic Analysis:** For each identified topic, send just that slice of the transcript (segments `start` to `end`) with a prompt asking for the topic's summary, key points (with speaker attribution), decisions, action items, open questions. A final assembly step rolls up action items and decisions, generates the overview, and classifies the meeting type.

### Provider Selection

The provider automatically selects the path based on `providerType`:
- `gemini`, `openai`, `claude` → single-pass
- `ollama` → multi-pass

### Method Signature

```typescript
// New method on LLMProvider interface
generateStructuredAnalysis(
  transcript: string,
  userNotes?: string,
): Promise<AnalysisDocumentV3>
```

### Cleanup — Removed Code

The following are replaced and removed:
- `generateAnalysisArtifacts()` method on UnifiedLLMProvider
- `generateUserAnalysisMarkdown()` method
- `generateSummary()` method (currently delegates to `generateAnalysisArtifacts`; replaced by `generateStructuredAnalysis`)
- `getSummaryPrompt()` in `prompts.ts`
- `getSummaryRepairPrompt()` in `prompts.ts`
- The repair loop in `UnifiedLLMProvider.generateAnalysisArtifacts()`
- `parseAnalysisMarkdown()` in `analysisDocument.ts`
- `fallbackAnalysisDocument()` in `analysisDocument.ts`
- `analysisDocumentToMarkdown()` in `analysisDocument.ts` (replaced with v3 renderer)
- Old `AnalysisDocument` interface in `provider.ts` (replaced by `AnalysisDocumentV3`)
- `fallbackAnalysisArtifacts()` in `main.ts`
- Client-side `parseAnalysisDocumentJson()`, `resolveMeetingAnalysisDocument()` in `src/utils/analysisDocument.ts`

New code:
- `getStructuredAnalysisPrompt()` in `prompts.ts` — single-pass prompt
- `getTopicSegmentationPrompt()` in `prompts.ts` — multi-pass pass 1
- `getTopicAnalysisPrompt()` in `prompts.ts` — multi-pass pass 2
- `parseAnalysisDocumentV3()` in `analysisDocument.ts` — JSON parser/validator for v3
- `analysisDocumentV3ToMarkdown()` in `analysisDocument.ts` — markdown renderer for v3
- `generateStructuredAnalysis()` on `UnifiedLLMProvider`

---

## User Notes Integration

User notes are passed as a separate section in the prompt with explicit instructions:

> "The user took these notes during the meeting. For each topic you identify, check if any user notes relate to it. If so, incorporate the note's content as emphasis or additional context within that topic's key points. Set `from_user_notes: true` on any point sourced from user notes."

This means user notes surface visibly in the output as first-class content anchored to the topics they belong to, rather than being an invisible context signal.

---

## UI — Document-Flow Layout

### Design Principle

The meeting view renders as a single flowing document — like notes a skilled executive assistant would write. No cards, no grid columns, no dashboard chrome. Topic headers as natural section breaks, points flowing underneath.

### Layout Structure

```
Meeting Title                                      April 9, 2026
Team Sync · 34 min · Sarah, Mike, You
─────────────────────────────────────────────────

Overview paragraph — 2-3 sentences on what this meeting
was about and the key outcomes.

─────────────────────────────────────────────────

Q2 Hiring Plan

• We need to backfill 2 senior eng roles before
  June when capacity drops 30%
• Sarah: Budget is capped at $180k per role
• 📝 Contractor option still on the table for infra
• Decision: Post the senior eng role by Friday
• ? Whether to hire contractor vs. FTE for infra

↩ Also discussed Mar 28

─────────────────────────────────────────────────

API Migration Timeline

• Mike walked through the v2→v3 migration plan
• Breaking change in auth — clients update by May 15
• Decision: Deprecation notice goes out Monday
• ? Mobile SDK impact unclear, needs testing

─────────────────────────────────────────────────

Action Items

☐ Sarah: Draft job description by EOW
☐ You: Get final budget sign-off from Finance
☐ Mike: Send deprecation email to partners
☐ Mike: Test mobile SDK against v3 auth flow
```

### Visual Conventions

- **Topic titles** render as clean section headers with slim dividers.
- **Speaker attribution** appears naturally: `Sarah: ...` at the start of a point when attribution matters.
- **User notes** are marked inline with 📝 emoji.
- **Decisions** are prefixed with `Decision:` in slightly different styling.
- **Open questions** are prefixed with `?`.
- **Continuity links** appear below a topic section as `↩ Also discussed [date]` when the topic entity was mentioned in a previous meeting. Data comes from the existing entity graph — no new LLM call needed.
- **Action items** are rolled up at the bottom as a checklist with assignee.
- **"View in Transcript"** link per topic — when clicked, expands the transcript panel and auto-scrolls to the relevant segment range. The linked transcript segments get a subtle colored left-border.

### Backward Compatibility

If `analysis_schema_version < 3` on a meeting, the UI renders the existing flat layout (Summary, Key Points, Action Items, Decisions) exactly as it works today. No visual regression for un-regenerated meetings.

---

## Continuity Links

When a topic title matches (or fuzzy-matches) an entity in the knowledge graph, and that entity has been mentioned in previous meetings, a continuity link appears below the topic section.

### Data Source

The entity graph already stores meeting-entity associations via `meeting_entities` table. After topic analysis, each topic title is matched against existing entities (topics, projects). If a match is found with appearances in other meetings, the most recent prior meeting title and date are surfaced.

### UI

A subtle link below the topic section:
```
↩ Also discussed in "Sprint Planning" — Mar 28
```

Clicking the link navigates to that meeting. This is a read-only display — no new LLM calls, no additional analysis. Pure entity graph lookup.

### Matching Logic

Topic titles are matched against existing entities using the same fuzzy matching from `entityPipeline.ts` (`findSimilarEntity` with `normalizeForMatch`). Only matches with similarity ≥ 0.85 are shown to avoid false positives.

---

## Inline Editability

### Scope

Users can click on any bullet point in the topic sections to edit it. Edits are saved as user overrides — the original LLM-generated content is preserved separately so the user can always revert.

### Data Model

A new `user_edits_json` field on the meeting row stores a map of edits:

```typescript
interface UserEditsMap {
  // Key format: "topic:{topicIndex}:point:{pointIndex}" or "topic:{topicIndex}:summary"
  [path: string]: {
    original: string;
    edited: string;
    edited_at: string;  // ISO timestamp
  };
}
```

### Interaction

- Clicking a bullet transitions it to an editable text input (contentEditable or textarea).
- On blur or Enter, the edit is saved via IPC to `user_edits_json`.
- Edited points get a subtle visual indicator (e.g., a small pencil icon or slightly different text color) so the user knows which points they've modified.
- A "Revert" option appears on hover for edited points, restoring the original text.

### Constraints

- Structural edits (adding/removing topics, reordering) are out of scope. Only text content within existing points is editable.
- The original `analysis_json` is never mutated. User edits are an overlay applied at render time.

---

## Integration with Existing Systems

### Entity Pipeline

The entity extraction pipeline (`entityPipeline.ts`) continues to run as a separate step after analysis. The v3 analysis document provides richer context for extraction:
- Topic titles map naturally to topic entities.
- Speaker-attributed points improve person entity extraction.
- The `all_action_items` array with assignees feeds directly into action_item entity creation.

### Knowledge Synthesis

The knowledge synthesis system (`knowledgeSynthesis.ts`) consumes analysis evidence via `extractAnalysisEvidence()`. This function needs updating to extract evidence from the v3 schema — pulling from `topics[].key_points`, `topics[].decisions`, and `all_action_items` instead of the flat arrays.

### MID Generator

The MID generator (`midGenerator.ts`) takes an `AnalysisDocument` as input. It needs updating to accept `AnalysisDocumentV3` — pulling participants from `topics[].key_points[].speaker`, decisions from `all_decisions`, etc.

### Value Signals

Value signal extraction remains a separate LLM call, unchanged. It receives the v3 analysis overview as its summary context (previously received the markdown rendering of the old analysis).

### IPC Handlers

- `GENERATE_ANALYSIS_V2` handler calls `generateStructuredAnalysis()` instead of `generateAnalysisArtifacts()`.
- `SAVE_MEETING` handler gains `user_edits_json` field support.
- Results are stored in `analysis_json` with `analysis_schema_version: 3`.

---

## Files Changed

### Modified

| File | Change |
|------|--------|
| `electron/llm/provider.ts` | Replace `AnalysisDocument` with `AnalysisDocumentV3`. Add `generateStructuredAnalysis` to `LLMProvider` interface. Remove `generateUserAnalysisMarkdown`, `generateAnalysisArtifacts` from interface. |
| `electron/llm/unifiedProvider.ts` | Implement `generateStructuredAnalysis()` with cloud single-pass and local multi-pass paths. Remove `generateAnalysisArtifacts()`, `generateUserAnalysisMarkdown()`, repair loop. |
| `electron/llm/prompts.ts` | Remove `getSummaryPrompt`, `getSummaryRepairPrompt`. Add `getStructuredAnalysisPrompt`, `getTopicSegmentationPrompt`, `getTopicAnalysisPrompt`. |
| `electron/llm/analysisDocument.ts` | Rewrite: remove `parseAnalysisMarkdown`, `fallbackAnalysisDocument`, old `analysisDocumentToMarkdown`. Add `parseAnalysisDocumentV3`, `analysisDocumentV3ToMarkdown`, `fallbackAnalysisDocumentV3`. |
| `electron/main.ts` | Update `GENERATE_ANALYSIS_V2` handler. Update `fallbackAnalysisArtifacts`. Add `user_edits_json` to SAVE_MEETING. |
| `electron/knowledgeSynthesis.ts` | Update `extractAnalysisEvidence()` and `parseAnalysisJson()` to handle v3 schema. |
| `electron/intelligence/midGenerator.ts` | Update to accept `AnalysisDocumentV3` input shape. |
| `electron/db.ts` | Add `user_edits_json` column to meetings table. |
| `src/types.ts` | Replace `AnalysisDocument` with `AnalysisDocumentV3`. Add `user_edits_json` to `Meeting` type. |
| `src/utils/analysisDocument.ts` | Rewrite for v3 schema parsing and markdown rendering. |
| `src/components/features/MeetingView.tsx` | Full redesign: document-flow layout, topic sections, continuity links, inline editability, transcript linking, backward-compatible v2 rendering. |
| `src/components/AudioManager.tsx` | Update analysis generation calls to use new method signature. |

### New

| File | Purpose |
|------|---------|
| `electron/llm/analysisDocumentV3.ts` | (If splitting from existing file) v3-specific parsing, validation, and rendering logic. |

---

## Verification Plan

### Automated Tests

- **Schema validation:** Unit tests for `parseAnalysisDocumentV3()` — valid v3 JSON, malformed JSON, missing fields, empty topics array.
- **Prompt output parsing:** Tests that mock LLM responses and verify the pipeline produces valid v3 documents.
- **Multi-pass assembly:** Tests for the local model path — topic segmentation followed by per-topic analysis, with correct rollup of action items and decisions.
- **Backward compatibility:** Tests confirming v2 schema meetings still render through the v2 rendering path without errors.
- **User edits overlay:** Tests for applying `user_edits_json` on top of `analysis_json` at render time.
- **Knowledge synthesis integration:** Tests that `extractAnalysisEvidence()` correctly pulls evidence from v3 documents.

### Manual Verification

- Record a real meeting, verify the structured analysis renders correctly with topic sections.
- Test with at least one cloud provider and Ollama to verify both pipeline paths.
- Edit a bullet point, navigate away and back, verify the edit persists.
- Record two meetings about the same topic, verify the continuity link appears on the second meeting.
- Open an old (v2) meeting, verify it renders with the flat layout without errors.
- Hit the regenerate button on an old meeting, verify it upgrades to v3 format.
