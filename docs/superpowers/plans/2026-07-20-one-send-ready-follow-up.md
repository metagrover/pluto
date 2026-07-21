# One Send-Ready Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-card follow-up export with one evidence-backed, editable draft that preserves per-format edits and degrades honestly when evidence is weak.

**Architecture:** Add a pure `followUpComposition.ts` boundary for deterministic composition, fingerprints, saved-document migration, edit preservation, and refinement merging. Keep `FollowUpDrafts.tsx` responsible for interaction state and IPC only, and update the existing LLM prompt to request coordinated variants from the same facts.

**Tech Stack:** TypeScript, React 18, Electron IPC, Vitest, Tailwind CSS, Biome.

---

### Task 1: Pure composition and persistence contract

**Files:**
- Create: `src/components/features/followUpComposition.ts`
- Create: `tests/unit/followUpComposition.test.ts`

- [ ] **Step 1: Write failing composition tests**

Add tests that call `buildFollowUpComposition()` with overview-only evidence, assert `availability: 'ready'`, verify Email/Internal/Slack use the same supported fact, omit empty sections and internal labels, enforce decision/action/question limits, and return `weak_evidence` for participant/entity-only input.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run tests/unit/followUpComposition.test.ts`

Expected: FAIL because `followUpComposition.ts` does not exist.

- [ ] **Step 3: Implement deterministic composition**

Define `FollowUpFormat = 'email' | 'internal' | 'slack'`, `FollowUpCompositionInput`, and the ready/weak `FollowUpComposition` union. Normalize whitespace, strip parenthetical `Project:`, `Topic:`, `Linked Context:`, `Status:`, `Context:`, `Why:`, and `Decided by:` details from sendable lines, select the first overview (or first topic/discussion fallback), cap decisions at 3, actions at 5, and questions at 3, and omit unsupported sections. Build a stable content-free fingerprint from an FNV-1a hash of normalized evidence.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/unit/followUpComposition.test.ts`

Expected: all composition tests pass.

- [ ] **Step 5: Add saved-document RED tests**

Test `parseSavedFollowUpDrafts()` for valid schema 2 and legacy `{ client, internal, slack }` migration. Test `resolveFollowUpDrafts()` preserving every saved variant when an edited document's fingerprint changes, and `mergeRefinedVariants()` replacing only unedited formats.

- [ ] **Step 6: Implement the saved-document helpers and verify GREEN**

Add `SavedFollowUpDraftsV2`, `createSavedFollowUpDrafts()`, `parseSavedFollowUpDrafts()`, `resolveFollowUpDrafts()`, and `mergeRefinedVariants()`. Return explicit parse states (`none`, `valid`, `legacy`, `invalid`) so malformed data can fall back without being overwritten.

Run: `pnpm exec vitest run tests/unit/followUpComposition.test.ts`

Expected: all tests pass.

### Task 2: One-draft interaction surface

**Files:**
- Modify: `src/components/features/FollowUpDrafts.tsx`
- Create: `tests/unit/FollowUpDrafts.test.tsx`

- [ ] **Step 1: Write failing component hierarchy tests**

Render ready and weak-evidence props with `renderToStaticMarkup()`. Assert the ready state contains `Ready to send`, one textarea, the three format buttons, and one primary `Copy` action; assert it excludes `Save Drafts` and the old simultaneous-card titles. Assert weak evidence says Pluto lacks enough meeting evidence and does not say `No follow-ups needed`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run tests/unit/FollowUpDrafts.test.tsx`

Expected: FAIL against the current three-card UI.

- [ ] **Step 3: Implement the one-card UI and interaction state**

Initialize from `buildFollowUpComposition()` plus `resolveFollowUpDrafts()`. Render a segmented Email/Internal/Slack switcher, one controlled textarea, one primary Copy button, quiet save/context-change status, and progressive Refine/Reset controls. Editing marks only the selected format edited. Switching formats preserves all variants. Clipboard failures show `Couldn’t copy`.

- [ ] **Step 4: Implement version-2 persistence**

Persist the complete `SavedFollowUpDraftsV2` document through `SAVE_MEETING` after a 500 ms debounce and on blur. Keep local edits on failure, expose `Retry save`, and call `fetchMeetings()` only after successful persistence. Reset explicitly adopts current deterministic variants and fingerprint.

- [ ] **Step 5: Implement safe refinement**

Map non-empty generated results to Email/Internal/Slack, reject empty responses, merge only unedited formats with `mergeRefinedVariants()`, preserve the current document on failure, and surface `Couldn’t refine` without resetting.

- [ ] **Step 6: Verify component GREEN**

Run: `pnpm exec vitest run tests/unit/FollowUpDrafts.test.tsx tests/unit/followUpComposition.test.ts`

Expected: all tests pass.

### Task 3: Coordinated refinement prompt

**Files:**
- Modify: `electron/llm/prompts.ts`
- Modify: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing prompt assertions**

Assert the prompt requests one evidence-backed follow-up rendered as coordinated Email/Internal/Slack variants, forbids internal metadata labels and invented facts, requires empty sections to be omitted, and no longer requests emoji.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: FAIL because the old prompt requests three distinct drafts and Slack emoji.

- [ ] **Step 3: Update the prompt and verify GREEN**

Keep the provider JSON contract unchanged, but rewrite instructions around shared facts, concise format-specific rendering, label suppression, evidence fidelity, omitted empty sections, and exact three-entry JSON output.

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`

Expected: all prompt tests pass.

### Task 4: Shipping record and complete verification

**Files:**
- Create: `docs/changelog/entries/2026-07-20-506-one-send-ready-follow-up.md`

- [ ] **Step 1: Add the issue-scoped changelog fragment**

Use one heading plus `Issue`, `PR`, `Changed`, `Why`, `Replaced`, and `Notes`. Record the single-draft hierarchy, versioned edit preservation, honest weak-evidence behavior, and credential-free fallback. Use `PR: pending` until the PR exists, then replace it with the final number.

- [ ] **Step 2: Run focused verification**

Run: `pnpm exec vitest run tests/unit/followUpComposition.test.ts tests/unit/FollowUpDrafts.test.tsx tests/unit/followUpDraftContext.test.ts tests/unit/prompts.test.ts`

Expected: all focused tests pass.

- [ ] **Step 3: Run repository verification**

Run: `pnpm run changelog:check`, `pnpm run lint`, `pnpm run test -- --run`, and `git diff --check origin/master...HEAD`.

Expected: every command exits 0. Any unrelated baseline failure is documented with exact output before proceeding.

- [ ] **Step 4: Browser QA**

Run the app and inspect a meeting with ready evidence and a weak-evidence meeting. Verify one editor in the first viewport, format switching, keyboard focus, copy feedback, responsive single-column layout, preserved edits, save feedback, and honest weak-evidence wording.

- [ ] **Step 5: Commit, push, open PR, and update #506**

Stage only issue files, commit with `feat: make follow-up drafts send-ready (#506)`, push `codex/506-send-ready-follow-up`, open a verified PR against `master`, add `codex` and `codex-automation`, update the changelog PR field if necessary, and comment on #506 with implementation and verification evidence.
