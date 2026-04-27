# Meeting Title Topic Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent brief personal openers from dominating future meeting titles/insights and provide an explicit backfill path for existing affected meetings.

**Architecture:** Add a small title-context sampler in the LLM prompt layer, then update prompt rules for title and structured analysis generation. Add a Node backfill script with pure helpers for argument parsing and database path resolution so behavior is testable without mutating a real database.

**Tech Stack:** TypeScript, Vitest, Electron IPC, Node scripts, SQLite CLI-compatible database path conventions.

---

### Task 1: Representative Title Context

**Files:**
- Modify: `electron/llm/prompts.ts`
- Test: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call `getTitlePrompt` with a neutral transcript. The transcript should open with `Jordan` asking about `Taylor`'s spouse recovering, then move into a longer work discussion about knowledge graph context studio, API snippets, reasoning chains, and Neo4j integration. Assert that the prompt contains later work terms and the rapport down-ranking instruction.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because `getTitlePrompt` only includes the opening transcript slice and does not include rapport down-ranking instructions.

- [ ] **Step 3: Implement minimal sampler**

In `electron/llm/prompts.ts`, add an exported helper like `buildRepresentativeTitleTranscript(transcript: string, maxChars = 2400): string`. For short transcripts, return the trimmed transcript. For long transcripts, include labeled opening, middle, and closing excerpts with roughly equal character budgets.

Update `getTitlePrompt` to call the helper and add rules that prefer sustained work topics over brief rapport, health, travel, family, schedule, or greeting exchanges.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: PASS.

### Task 2: Structured Analysis Prompt Guardrail

**Files:**
- Modify: `electron/llm/prompts.ts`
- Test: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing test**

Add a test that calls `getStructuredAnalysisPrompt` and asserts it includes guidance to treat brief rapport or personal check-ins as minor context unless they are the sustained subject.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because the prompt has no explicit minor-context guardrail.

- [ ] **Step 3: Add prompt guardrail**

Update `getStructuredAnalysisPrompt` and `getStructuredAnalysisRepairPrompt` with concise rules:

- Brief rapport/personal check-ins can be included as context.
- Do not make them major topics or overview leads when most of the meeting is work-focused.
- If the personal topic is sustained or produces follow-up, represent it normally.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: PASS.

### Task 3: Backfill Helpers

**Files:**
- Create: `scripts/meeting_backfill_helpers.mjs`
- Test: `tests/unit/meetingBackfillHelpers.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests for:

- `parseBackfillArgs([])` returns dry-run defaults.
- `parseBackfillArgs(['--write', '--meeting-id', 'abc'])` enables write mode and stores the meeting id.
- `resolvePlutoDbPath({ explicitDbPath: '/tmp/custom.db' })` returns the explicit path.
- `resolvePlutoDbPath({ env: { PLUTO_DB_PATH: '/tmp/env.db' } })` returns the environment path.
- `resolvePlutoDbPath({ platform: 'darwin', homeDir: '/Users/example', appName: 'pluto' })` returns `/Users/example/Library/Application Support/pluto/pluto.db`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/meetingBackfillHelpers.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement helpers**

Create pure helper functions in `scripts/meeting_backfill_helpers.mjs`. Keep them dependency-free and side-effect-free.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/meetingBackfillHelpers.test.ts`

Expected: PASS.

### Task 4: Backfill Script

**Files:**
- Create: `scripts/backfill_meeting_title_analysis.mjs`
- Modify: `package.json`
- Test: `tests/unit/meetingBackfillHelpers.test.ts`

- [ ] **Step 1: Write failing test**

Extend helper tests for `buildMeetingWhereClause` or equivalent query helper so the script can target by `meetingId` or title search while rejecting an empty write target.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/meetingBackfillHelpers.test.ts`

Expected: FAIL because query helper is missing.

- [ ] **Step 3: Implement script and npm entry**

Create `scripts/backfill_meeting_title_analysis.mjs` that:

- Parses args using the helper.
- Resolves DB path.
- Loads matching meetings.
- In dry-run, prints the matching meeting ids/titles and instructions for running with `--write`.
- In write mode, uses existing LLM provider code to regenerate title and analysis artifacts, then updates the meeting row and FTS data.

Add a package script such as `backfill:meeting-intelligence`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/meetingBackfillHelpers.test.ts`

Expected: PASS.

### Task 5: Verification

**Files:**
- Modify only files already touched in earlier tasks if fixes are needed.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm exec vitest run tests/unit/prompts.test.ts tests/unit/meetingBackfillHelpers.test.ts tests/unit/unifiedProvider.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint if targeted tests pass**

Run: `pnpm run lint`

Expected: PASS or pre-existing unrelated failures documented in the final response.

- [ ] **Step 3: Dry-run the backfill target**

Run:

```bash
pnpm run backfill:meeting-intelligence -- --title "Flu Season" --dry-run
```

Expected: It prints the active app DB path, matching meeting title(s), and says no writes were made.

- [ ] **Step 4: Apply backfill only after dry-run looks correct**

Run:

```bash
pnpm run backfill:meeting-intelligence -- --title "Flu Season" --write
```

Expected: The affected meeting title and analysis are regenerated with the improved prompt behavior.
