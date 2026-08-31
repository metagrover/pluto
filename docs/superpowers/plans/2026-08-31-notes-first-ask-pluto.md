# Notes-first Ask Pluto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every saved-meeting Ask Pluto entry point retrieve compact, user-corrected notes by default, with bounded transcript access only for explicit quotation or when no notes exist.

**Architecture:** A pure evidence-document builder projects saved notes, structured analysis, MID fields, and user edit overlays into a rebuildable notes-only FTS index. Global and meeting-scoped chat share a deterministic evidence policy; live chat keeps its transcript path. Saved synthesis uses the general Gemma route, while safe single-meeting recall can return structured evidence without model generation.

**Tech Stack:** Electron main process, TypeScript, better-sqlite3 FTS5, Vitest, existing Pluto analysis/edit projection utilities.

---

### Task 1: Define saved-meeting evidence policy and effective notes projection

**Files:**
- Create: `electron/intelligence/meetingNotesEvidence.ts`
- Test: `tests/unit/meetingNotesEvidence.test.ts`

- [ ] **Step 1: Write failing policy and projection tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMeetingNotesEvidenceDocument,
  resolveSavedMeetingEvidencePolicy,
} from '../../electron/intelligence/meetingNotesEvidence';

it('keeps ordinary speaker questions on notes and escalates explicit quotations', () => {
  expect(resolveSavedMeetingEvidencePolicy('What did Sam say about launch?', true))
    .toBe('notes_only');
  expect(resolveSavedMeetingEvidencePolicy('Quote exactly what Sam said', true))
    .toBe('transcript_exact');
  expect(resolveSavedMeetingEvidencePolicy('What happened?', false))
    .toBe('transcript_fallback');
});

it('projects user-edited note blocks without transcript text', () => {
  const document = buildMeetingNotesEvidenceDocument({
    id: 'm1',
    title: 'Launch review',
    enhanced_notes: 'Old launch wording',
    analysis_json: JSON.stringify({
      analysis_schema_version: 3,
      overview: 'Old launch wording',
      topics: [], all_decisions: [], all_action_items: [],
    }),
    user_edits_json: JSON.stringify({
      overview: { original: 'Old launch wording', edited: 'Launch moved to Friday', edited_at: '2026-08-31T00:00:00Z' },
    }),
    transcript_json: JSON.stringify({ segments: [{ text: 'private transcript phrase' }] }),
  });
  expect(JSON.stringify(document)).toContain('Launch moved to Friday');
  expect(JSON.stringify(document)).not.toContain('private transcript phrase');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/meetingNotesEvidence.test.ts --maxWorkers=1`

Expected: FAIL because `meetingNotesEvidence` does not exist.

- [ ] **Step 3: Implement the pure policy and projection**

Create a module exporting:

```ts
export type SavedMeetingEvidencePolicy =
  | 'notes_only'
  | 'transcript_exact'
  | 'transcript_fallback';

export interface MeetingNotesEvidenceDocument {
  meetingId: string;
  title: string;
  notesText: string;
  decisionsText: string;
  actionItemsText: string;
  topicsText: string;
  participantsText: string;
  hasUsableNotes: boolean;
}

export const resolveSavedMeetingEvidencePolicy = (
  query: string,
  hasUsableNotes: boolean,
): SavedMeetingEvidencePolicy =>
  /\b(quote|verbatim|word for word|exact(?:ly)?(?: what| how)?|exact words?)\b/i.test(query)
    ? 'transcript_exact'
    : hasUsableNotes
      ? 'notes_only'
      : 'transcript_fallback';
```

Use `parseAnalysisDocumentV3Json`, `parseUserEditsJson`, and `buildMeetingNotesDocument` to flatten effective block text. Parse MID independently for participants/topics/decisions/actions. Never read `transcript_json` in the document builder.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/meetingNotesEvidence.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/intelligence/meetingNotesEvidence.ts tests/unit/meetingNotesEvidence.test.ts
git commit -m "feat: define saved meeting evidence policy"
```

### Task 2: Add a rebuildable notes-only search index

**Files:**
- Modify: `electron/db.ts`
- Modify: `tests/unit/dbMeetingSearchIndex.test.ts`

- [ ] **Step 1: Write failing index-isolation tests**

Add a meeting whose notes contain `Orchid` and transcript contains `Cobalt`, then assert:

```ts
expect(searchMeetingNotesFts('"Orchid"')).toHaveLength(1);
expect(searchMeetingNotesFts('"Cobalt"')).toHaveLength(0);
```

Save the same meeting with a user edit replacing `Orchid` with `Marigold`, then assert the old term disappears and the edited term is searchable. Extend integrity assertions to cover one derived notes row per meeting.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/dbMeetingSearchIndex.test.ts --maxWorkers=1`

Expected: FAIL because `searchMeetingNotesFts` does not exist.

- [ ] **Step 3: Implement schema, refresh, repair, and search**

Create at initialization:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS meeting_notes_fts USING fts5(
  title,
  notes_text,
  decisions_text,
  action_items_text,
  topics_text,
  participants_text,
  meeting_id UNINDEXED
);
```

Add `refreshMeetingNotesFts(meeting)` beside `refreshMeetingFts`. Call both from the same transaction on every current refresh path. Add startup repair based on row count/distinct IDs and export:

```ts
export const searchMeetingNotesFts = (query: string, options: SearchFtsOptions = {}) =>
  db.prepare(`SELECT m.*, snippet(meeting_notes_fts, -1, '', '', '...', 64) AS snippet
    FROM meeting_notes_fts f JOIN meetings m ON f.meeting_id = m.id
    WHERE meeting_notes_fts MATCH ? ORDER BY rank LIMIT ?`)
    .all(query, options.limit || 50) as (PersistedMeeting & { snippet: string })[];
```

Include `meeting_notes_fts` in knowledge-base reset. The table remains derived and rebuildable; never modify source notes during repair.

- [ ] **Step 4: Run index tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/dbMeetingSearchIndex.test.ts tests/unit/meetingNotesEvidence.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/db.ts tests/unit/dbMeetingSearchIndex.test.ts
git commit -m "feat: index saved meeting notes separately"
```

### Task 3: Make global saved-meeting retrieval notes-only

**Files:**
- Modify: `electron/intelligence/queryEngine.ts`
- Modify: `tests/unit/queryEngine.test.ts`

- [ ] **Step 1: Write failing retrieval tests**

Mock `searchMeetingNotesFts`, not `searchMeetingsFts`, and assert the resulting evidence contains effective notes/analysis but no transcript. Replace the existing long-transcript sampling test with:

```ts
it('never includes transcript text in normal saved meeting evidence', () => {
  const result = buildMeetingRetrievalResult({
    id: 'm1', title: 'Review', enhanced_notes: 'Launch moved to Friday.',
    transcript_json: JSON.stringify({ segments: [{ text: 'Cobalt transcript secret' }] }),
  } as PersistedMeeting);
  expect(result.evidence_text).toContain('Launch moved to Friday');
  expect(result.evidence_text).not.toContain('Cobalt transcript secret');
  expect(result.evidence_text).not.toContain('[Transcript');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/queryEngine.test.ts --maxWorkers=1`

Expected: FAIL because retrieval still calls the mixed transcript index and appends transcript excerpts.

- [ ] **Step 3: Switch retrieval to the derived notes document**

Import `searchMeetingNotesFts` and `buildMeetingNotesEvidenceDocument`. `buildMeetingRetrievalResult` must serialize only title/time plus bounded note, decision, action, topic, and participant fields. `retrieveContext` must search `meeting_notes_fts` and build evidence from the canonical meeting row instead of trusting a mixed-index snippet as answer evidence.

Keep `buildLiveMeetingRetrievalResult` unchanged. Keep the old mixed index for non-Ask-Pluto compatibility until a separately evidenced removal.

- [ ] **Step 4: Run query and temporal regressions**

Run: `pnpm exec vitest run tests/unit/queryEngine.test.ts tests/unit/askPlutoConversation.test.ts tests/unit/askPlutoConversationReplay.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/intelligence/queryEngine.ts tests/unit/queryEngine.test.ts
git commit -m "feat: retrieve Ask Pluto context from notes"
```

### Task 4: Apply the same policy to meeting-scoped chat

**Files:**
- Modify: `electron/intelligence/meetingAskPluto.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/meetingAskPlutoContext.test.ts`

- [ ] **Step 1: Write failing saved/live/escalation tests**

Assert normal completed context contains no `transcript` evidence, explicit quote intent contains at most five bounded transcript items, no-notes fallback contains transcript with `weak_evidence`, and live context still retains its latest 24 transcript segments.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/meetingAskPlutoContext.test.ts --maxWorkers=1`

Expected: FAIL because completed context always reserves transcript evidence.

- [ ] **Step 3: Pass query into the saved context builder and enforce policy**

Change the call and signature to:

```ts
buildMeetingAskPlutoContext({ meeting, query, entities, attentionItems })
```

Build notes/analysis/MID evidence first. Resolve policy from `query` and whether that evidence exists. Add transcript items only for `transcript_exact` or `transcript_fallback`; do not add MID evidence quotes as transcript items on `notes_only`. Set the fallback status note and trust state to disclose weak transcript evidence.

- [ ] **Step 4: Run meeting-chat boundary and context tests**

Run: `pnpm exec vitest run tests/unit/meetingAskPlutoContext.test.ts tests/unit/meetingAskPlutoIpcBoundary.test.ts tests/unit/meetingAskPlutoRequest.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/intelligence/meetingAskPluto.ts electron/main.ts tests/unit/meetingAskPlutoContext.test.ts
git commit -m "feat: enforce notes-first meeting chat"
```

### Task 5: Keep saved synthesis on Gemma and ship traceability

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `tests/unit/unifiedProvider.test.ts`
- Modify: `tests/unit/meetingNotesProviderRouting.test.ts`
- Create: `docs/changelog/entries/2026-08-31-699-notes-first-ask-pluto.md`

- [ ] **Step 1: Write the failing model-routing test**

Assert `askPluto` and `askPlutoDeep` resolve to the configured/general Gemma model, while `askPlutoLive` and `queryClassification` retain the quick Phi route. Confirm production budgets remain 192/512/768.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/unifiedProvider.test.ts tests/unit/meetingNotesProviderRouting.test.ts --maxWorkers=1`

Expected: FAIL because saved `askPluto` currently resolves to the fast model.

- [ ] **Step 3: Route completed chat to the general model**

Update `resolveOllamaModel` so only `askPlutoLive` and `queryClassification` return `ollama_fast_model || OLLAMA_QUICK_CHAT_MODEL`; saved `askPluto` falls through to `ollama_model || llm_model || OLLAMA_GENERAL_MODEL`.

- [ ] **Step 4: Add the changelog fragment**

Document issue #699, notes-only saved retrieval, explicit transcript escalation, live transcript preservation, user-edit indexing, and retained Ollama runtime. State that direct runtimes and parallel decoding remain gated follow-up work.

- [ ] **Step 5: Run the Slice A verification set**

Run:

```bash
pnpm exec vitest run \
  tests/unit/meetingNotesEvidence.test.ts \
  tests/unit/dbMeetingSearchIndex.test.ts \
  tests/unit/queryEngine.test.ts \
  tests/unit/meetingAskPlutoContext.test.ts \
  tests/unit/meetingAskPlutoIpcBoundary.test.ts \
  tests/unit/meetingAskPlutoRequest.test.ts \
  tests/unit/askPlutoConversation.test.ts \
  tests/unit/askPlutoConversationReplay.test.ts \
  tests/unit/unifiedProvider.test.ts \
  tests/unit/meetingNotesProviderRouting.test.ts \
  --maxWorkers=1
pnpm run lint
pnpm run build
```

Expected: all focused tests pass, lint exits 0, build exits 0.

- [ ] **Step 6: Commit**

```bash
git add electron/llm/unifiedProvider.ts tests/unit/unifiedProvider.test.ts tests/unit/meetingNotesProviderRouting.test.ts docs/changelog/entries/2026-08-31-699-notes-first-ask-pluto.md
git commit -m "feat: keep saved Ask Pluto on Gemma"
```

### Task 6: Production-path benchmark and private acceptance

**Files:**
- Modify: `src/services/askPlutoBenchmark.ts`
- Modify: `scripts/run_ask_pluto_benchmark.ts`
- Modify: `tests/unit/askPlutoBenchmark.test.ts`

- [ ] **Step 1: Write a failing benchmark contract test**

Require each result to report `policy`, `retrievalMs`, `queueMs`, `firstTokenMs`, `generationMs`, `totalMs`, `promptChars`, `evidenceChars`, `sourceCount`, and `coldStart`, without meeting text or titles.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run tests/unit/askPlutoBenchmark.test.ts --maxWorkers=1`

Expected: FAIL because the current benchmark bypasses production retrieval and lacks the timing contract.

- [ ] **Step 3: Route the benchmark through production retrieval and budgets**

Use the same query parser, evidence policy, `retrieveContext`, prompt builder, `answerAskPluto`, and response validation as the IPC handler. Keep private meeting IDs content-free in output and never serialize prompts, evidence, titles, snippets, or answers.

- [ ] **Step 4: Verify synthetic and bounded private acceptance**

Run the unit benchmark test, then execute one read-only private warm run for normal notes recall and one explicit quote run. Verify normal output reports `notes_only` and zero transcript sources; do not persist meeting or model changes.

- [ ] **Step 5: Commit**

```bash
git add src/services/askPlutoBenchmark.ts scripts/run_ask_pluto_benchmark.ts tests/unit/askPlutoBenchmark.test.ts
git commit -m "test: benchmark the production Ask Pluto path"
```

After Slice A is verified, write and execute a separate plan for the provider-neutral inference coordinator, early single-instance bootstrap, isolated development profile, and identical Ollama/llama.cpp/MLX runtime comparison. Those lifecycle changes form an independently testable Slice B and must not be mixed into notes retrieval commits.
