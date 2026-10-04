# Global Meeting Analysis Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce concise, outcome-oriented meeting notes by globally consolidating multi-topic local analysis, resolving high-confidence terminology from meeting-wide context, and retaining explicit commitments whose evidence crosses transcript segment boundaries.

**Architecture:** Keep the canonical transcript unchanged. Ollama continues to segment and analyze bounded transcript slices, then a single global editorial call receives the raw transcript plus the draft topic document and returns the final `AnalysisDocumentV3`; the existing grounding boundary validates settled items against raw evidence afterward. Extend grounding only to resolve verbatim evidence across at most three adjacent transcript lines, preserving the exact-evidence policy while recovering clauses split by transcription segmentation.

**Tech Stack:** TypeScript, Vitest, local Ollama/Qwen structured JSON generation, existing `AnalysisDocumentV3` parser and grounding pipeline.

---

### Task 1: Restore the current prompt safety baseline

**Files:**
- Modify: `electron/llm/prompts.ts`
- Test: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Re-run the existing failing prompt tests**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because the current RTCO prompt no longer contains the required rapport and suggestion/commitment safeguards.

- [ ] **Step 2: Restore the missing constraints without reverting RTCO structure**

Add these requirements to the structured single-pass and per-topic prompt constraints:

```ts
- Brief rapport and personal check-ins may be included as minor context, but do not make them major topics or lead the overview when the meeting is work-focused.
- Treat explicit third-person commitments such as "Person will do task by date" as action items when the same evidence supports the owner and timing.
- Do not turn suggestions, ideas, possible tasks, or hypothetical work into action items.
- Preserve dates, conditions, and qualifiers so conditional agreements remain conditional.
```

- [ ] **Step 3: Verify the prompt baseline is green**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the baseline repair**

```bash
git add electron/llm/prompts.ts tests/unit/prompts.test.ts
git commit -m "fix(analysis): restore structured prompt safeguards"
```

### Task 2: Resolve exact evidence across adjacent transcript segments

**Files:**
- Modify: `electron/llm/analysisGrounding.ts`
- Test: `tests/unit/analysisGrounding.test.ts`

- [ ] **Step 1: Write a failing adjacent-line evidence test**

Add a test that passes this transcript and evidence:

```ts
const resolved = resolveTranscriptEvidence(
  "I'll prepare the rollout checklist by Friday.",
  [
    "Milo: I'll prepare the rollout",
    'Milo: checklist by Friday.',
  ].join('\n'),
);

expect(resolved).toMatchObject({
  lineIndex: 0,
  sourceLine: "Milo: I'll prepare the rollout Milo: checklist by Friday.",
});
```

Add a negative test proving that evidence cannot bridge more than three lines.

- [ ] **Step 2: Run the grounding test and verify RED**

Run: `pnpm exec vitest run tests/unit/analysisGrounding.test.ts`

Expected: FAIL because evidence is currently resolved one line at a time.

- [ ] **Step 3: Implement bounded adjacent-line resolution**

Change `resolveTranscriptEvidence` to inspect one-, two-, and three-line spans beginning at each transcript line:

```ts
const MAX_EVIDENCE_SPAN_LINES = 3;

for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
  for (
    let spanLength = 1;
    spanLength <= MAX_EVIDENCE_SPAN_LINES &&
    lineIndex + spanLength <= lines.length;
    spanLength += 1
  ) {
    const sourceLine = lines
      .slice(lineIndex, lineIndex + spanLength)
      .join(' ');
    if (normalizeTranscriptEvidence(sourceLine).includes(normalizedEvidence)) {
      return { evidence: evidence?.trim() ?? '', sourceLine, lineIndex };
    }
  }
}
```

Do not add fuzzy matching or lower the claim-support threshold.

- [ ] **Step 4: Verify grounding tests are green**

Run: `pnpm exec vitest run tests/unit/analysisGrounding.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit evidence-span support**

```bash
git add electron/llm/analysisGrounding.ts tests/unit/analysisGrounding.test.ts
git commit -m "fix(analysis): ground evidence across adjacent segments"
```

### Task 3: Define the global editorial contract

**Files:**
- Modify: `electron/llm/prompts.ts`
- Modify: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write a failing editorial-prompt contract test**

Import `getStructuredAnalysisEditorialPrompt` and assert the prompt contains:

```ts
expect(prompt).toContain('global meeting-notes editor');
expect(prompt).toContain('Merge overlapping or duplicate topics');
expect(prompt).toContain('meeting-wide terminology');
expect(prompt).toContain('Never alter quoted evidence');
expect(prompt).toContain('Preserve uncertainty');
expect(prompt).toContain('3-sentence executive summary');
expect(prompt).toContain('Raw transcript');
expect(prompt).toContain('Draft local analysis');
```

- [ ] **Step 2: Run the prompt test and verify RED**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because the editorial prompt does not exist.

- [ ] **Step 3: Add the editorial prompt builder**

Create this exported function in `electron/llm/prompts.ts`:

```ts
export const getStructuredAnalysisEditorialPrompt = (
  transcript: string,
  draftAnalysisJson: string,
  userNotes?: string,
): string => `You are Pluto's global meeting-notes editor.

${STRUCTURED_EXTRACTION_POLICY}

Revise the draft local analysis into one coherent AnalysisDocumentV3.

Editorial rules:
- Merge overlapping or duplicate topics created by transcript windows.
- Produce a factual 3-sentence executive summary of purpose, outcomes, commitments, risks, and unresolved blockers; never enumerate every topic title.
- Re-scan the raw transcript for explicit assignments, accepted requests, deadlines, and settled decisions omitted by the draft.
- Use meeting-wide terminology consistently only when repeated transcript context strongly supports the interpretation. Treat draft spellings as hypotheses. Preserve the raw wording when ambiguous.
- Never alter quoted evidence. Evidence must remain a short verbatim slice of the raw transcript.
- Preserve uncertainty, conditions, dates, numeric targets, and speaker ambiguity.
- Prefer a small number of outcome-level topics; do not force unrelated material together.
- Return the complete AnalysisDocumentV3 JSON object and no commentary.

${userNotes ? `User notes (high-priority emphasis, not independent evidence):\n${userNotes}\n` : ''}
Raw transcript:\n${transcript}

Draft local analysis:\n${draftAnalysisJson}`;
```

The real prompt must restate the exact JSON schema so malformed or partial editor output is rejected by the existing parser.

- [ ] **Step 4: Verify prompt tests are green**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the editorial contract**

```bash
git add electron/llm/prompts.ts tests/unit/prompts.test.ts
git commit -m "feat(analysis): define global editorial synthesis prompt"
```

### Task 4: Run editorial synthesis for multi-topic Ollama analysis

**Files:**
- Modify: `electron/llm/analysisTypes.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `tests/unit/unifiedProvider.test.ts`
- Modify: `tests/manual/meetingNotesQualityBenchmark.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add tests proving:

```ts
// A two-topic draft triggers one editorial call.
expect(prompts.filter((prompt) => prompt.includes('global meeting-notes editor')))
  .toHaveLength(1);
expect(analysis.overview).toBe('The edited executive summary.');
expect(analysis.topics).toHaveLength(1);

// Invalid editor JSON falls back to the grounded local draft.
expect(analysis.topics.map((topic) => topic.title)).toEqual([
  'Alpha topic',
  'Beta topic',
]);
expect(analysis.generation_metadata?.error_categories).toContain(
  'editorial_invalid_json',
);
```

Also assert that a one-topic analysis does not pay for an editorial call.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `pnpm exec vitest run tests/unit/unifiedProvider.test.ts`

Expected: FAIL because no editorial call exists.

- [ ] **Step 3: Add the editorial task and failure categories**

Extend `LLMTask` with `analysisEditorial`, route it through the structured-analysis Qwen model, allocate the same 4,096-token output budget, and allow a 32,768-token context cap. Extend `AnalysisErrorCategory` with:

```ts
| 'editorial_invalid_json'
| 'editorial_failed'
```

- [ ] **Step 4: Build and edit the local draft**

In `generateStructuredAnalysisMultiPass`, first construct the existing local draft. When it has more than one topic, serialize only the fields needed by the editor:

```ts
const draftContext = JSON.stringify({
  overview: localDraft.overview,
  topics: localDraft.topics,
  meeting_type: localDraft.meeting_type,
});
```

Generate one `analysisEditorial` response and parse it with `parseAnalysisDocumentV3`. Use the edited document only when it parses and contains at least one topic. On non-abort generation failure or invalid JSON, retain the local draft and append the matching error category. Apply `finalizeStructuredAnalysis` exactly once after this choice so both paths share raw-transcript grounding.

Restore the local fallback overview to the concatenated topic summaries rather than a list of titles.

- [ ] **Step 5: Correct prompt-version baseline semantics**

Bump `STRUCTURED_ANALYSIS_PROMPT_VERSION` to `notes-v7`. Keep the pinned Phi comparison artifact at `notes-v6`; update the manual benchmark guard to validate the baseline against the explicit comparison version instead of requiring the candidate prompt version to equal the baseline prompt version.

- [ ] **Step 6: Verify provider and benchmark-contract tests**

Run:

```bash
pnpm exec vitest run tests/unit/unifiedProvider.test.ts
pnpm exec vitest run tests/manual/meetingNotesQualityBenchmark.test.ts --passWithNoTests
```

Expected: unit PASS; the manual suite remains excluded unless explicitly enabled.

- [ ] **Step 7: Commit orchestration**

```bash
git add electron/llm/analysisTypes.ts electron/llm/unifiedProvider.ts tests/unit/unifiedProvider.test.ts tests/manual/meetingNotesQualityBenchmark.test.ts
git commit -m "feat(analysis): synthesize multi-topic notes globally"
```

### Task 5: Record the architecture and shipped behavior

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-18-627-global-analysis-editor.md`

- [ ] **Step 1: Record the durable decision**

Append an accepted decision stating that canonical transcript evidence remains immutable, local topic extraction is a draft, global editorial synthesis may normalize high-confidence terminology in notes, and every settled item remains grounded against the raw transcript.

- [ ] **Step 2: Add the changelog fragment**

Use this structure:

```md
### Turn long meetings into coherent outcome-level notes

- **Issue:** [#627](https://github.com/metagrover/pluto/issues/627)
- **PR:** Not opened yet.
- **Changed:** Multi-topic local analysis now receives one meeting-wide editorial synthesis that merges window overlap, writes an executive overview, normalizes strongly supported terminology, and rechecks commitments.
- **Why:** Long meetings previously produced overlapping micro-topics, title-list overviews, inconsistent terminology, and missing settled work.
- **Notes:** Canonical transcript text is unchanged; decisions and actions still require exact raw-transcript evidence, now across at most three adjacent segments.
```

- [ ] **Step 3: Validate documentation**

Run: `pnpm run changelog:check`

Expected: PASS.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/decisions.md docs/changelog/entries/2026-08-18-627-global-analysis-editor.md
git commit -m "docs(analysis): record global editor boundary"
```

### Task 6: Verify quality and repository gates

**Files:**
- Modify only if a failing in-scope test exposes a defect.

- [ ] **Step 1: Run targeted deterministic tests**

```bash
pnpm exec vitest run tests/unit/prompts.test.ts tests/unit/analysisGrounding.test.ts tests/unit/unifiedProvider.test.ts tests/unit/analysisDocumentV3.test.ts tests/unit/meetingNotesQuality.test.ts
```

Expected: PASS with no failures.

- [ ] **Step 2: Run the real-provider three-seed quality gate**

```bash
OLLAMA_BENCHMARK_MODEL=qwen3.5:9b \
OLLAMA_BENCHMARK_REPEATS=3 \
pnpm run benchmark:meeting-notes-quality
```

Expected: reviewed score at least 40/48 on every seed, zero precision false positives and false negatives, exact evidence for every retained settled item, no fallback/malformed output, average latency at most 30 seconds, and resident memory at most 6.5 GB. Keep the report content-free.

- [ ] **Step 3: Run the full repository gates**

```bash
pnpm run test
pnpm run lint
pnpm run audit:high
pnpm run changelog:check
pnpm run build
```

Expected: PASS. If a command does not exist, record that exact result and use the closest repository-defined gate rather than inventing one.

- [ ] **Step 4: Inspect final scope**

```bash
git status --short
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
```

Expected: only issue #627 implementation, tests, decision log, plan, and changelog files are changed; no meeting content or local paths appear in committed artifacts.
