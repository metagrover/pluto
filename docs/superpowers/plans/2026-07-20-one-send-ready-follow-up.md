# One Send-Ready Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-card follow-up draft grid with one trustworthy, editable follow-up whose Email, Internal, and Slack formats share the same prioritized meeting evidence.

**Architecture:** Add a pure `followUpDraftComposition` module that normalizes evidence, composes coordinated variants, fingerprints source context, and parses/version-controls saved documents. Keep `FollowUpDrafts` responsible for interaction state, debounced persistence, copy/refinement feedback, and the single-editor hierarchy. Update the existing LLM prompt contract to refine coordinated variants without inventing facts.

**Tech Stack:** React 18, TypeScript, Electron IPC, Vitest, React DOM server rendering, Tailwind utility classes.

---

### Task 1: Pure composition and saved-document contract

**Files:**
- Create: `src/components/features/followUpDraftComposition.ts`
- Create: `tests/unit/followUpDraftComposition.test.ts`

- [ ] **Step 1: Write failing composition tests**

Cover ready/weak selection, lifecycle-prioritized caps, removal of metadata labels, omission of empty sections, coordinated variants, stable fingerprints, legacy draft parsing, and preservation of edited variants when the fingerprint changes.

```ts
const result = composeFollowUp({ meetingTitle: 'Launch review', decisions: ['Ship Friday (Decided by: Ana)'], actionItems: ['Publish notes (Owner: Lee | Status: active)'], openQuestions: [] });
expect(result.state).toBe('ready');
expect(result.variants.email).toContain('Ship Friday');
expect(result.variants.email).not.toMatch(/Decided by:|Status:/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/unit/followUpDraftComposition.test.ts`
Expected: FAIL because `followUpDraftComposition` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Define `FollowUpFormat`, `FollowUpVariants`, `FollowUpEvidence`, `FollowUpComposition`, and version-2 `SavedFollowUpDocument`. Export `composeFollowUp`, `createEvidenceFingerprint`, `parseSavedFollowUpDocument`, `mergeSavedFollowUp`, and `serializeSavedFollowUpDocument`. Use deterministic normalization, lifecycle priority (`blocked`, `overdue`, `active`, routine), caps of two decisions/three actions/two questions, and no empty headings.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/followUpDraftComposition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the pure model**

```bash
git add src/components/features/followUpDraftComposition.ts tests/unit/followUpDraftComposition.test.ts
git commit -m "feat: compose one send-ready follow-up (#506)"
```

### Task 2: Single-editor interaction surface

**Files:**
- Modify: `src/components/features/FollowUpDrafts.tsx`
- Create: `tests/unit/FollowUpDrafts.test.tsx`

- [ ] **Step 1: Write failing render-level tests**

Render the component to static markup and prove the first viewport contains `Follow-up`, `Ready to send`, one textbox, a three-format tablist, and a primary `Copy` action. Prove weak evidence renders an honest explanation without a textbox and never says `No follow-ups needed`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/unit/FollowUpDrafts.test.tsx`
Expected: FAIL against the current three-textarea grid and action/decision-only empty state.

- [ ] **Step 3: Implement the single-editor UI and state contract**

Use the pure composition result and saved-document parser. Show one active format at a time with Email/Internal/Slack tabs, a single textarea, primary Copy, quiet save/context-change feedback, and secondary refinement controls. Mark only the active variant edited. Debounce complete version-2 document persistence through `SAVE_MEETING`; retain in-memory edits on save failure and expose retry. Clipboard failure must show `Couldn’t copy`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/FollowUpDrafts.test.tsx tests/unit/followUpDraftComposition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the interaction surface**

```bash
git add src/components/features/FollowUpDrafts.tsx tests/unit/FollowUpDrafts.test.tsx
git commit -m "feat: show one follow-up draft at a time (#506)"
```

### Task 3: Coordinated refinement prompt

**Files:**
- Modify: `electron/llm/prompts.ts`
- Modify: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Assert that the prompt requests named Email/Internal/Slack variants from one evidence packet, forbids internal metadata labels and invented facts, and instructs empty evidence to return no filler.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`
Expected: FAIL because the current prompt asks for three distinct drafts and does not encode the coordinated-variant trust contract.

- [ ] **Step 3: Update the prompt minimally**

Keep the existing provider response schema, but require three coordinated renderings of the same supported facts, concise channel-specific tone, metadata-label suppression, and an empty array when evidence cannot support a useful follow-up.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the prompt contract**

```bash
git add electron/llm/prompts.ts tests/unit/prompts.test.ts
git commit -m "feat: coordinate follow-up refinement formats (#506)"
```

### Task 4: Shipping record and full verification

**Files:**
- Create: `docs/changelog/entries/2026-07-20-506-one-send-ready-follow-up.md`

- [ ] **Step 1: Add the issue-scoped changelog fragment**

Record Issue `#506`, the implementation PR number after creation, the single-draft behavior, why metadata-dump drafts were replaced, and that outbound sending remains out of scope.

- [ ] **Step 2: Run focused and repository verification**

Run:

```bash
pnpm exec vitest run tests/unit/followUpDraftComposition.test.ts tests/unit/FollowUpDrafts.test.tsx tests/unit/prompts.test.ts
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
git diff --check origin/master...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform app/browser QA**

Run Pluto in dev mode, open a completed meeting with strong evidence and one with weak evidence, and verify single-editor hierarchy, format switching, keyboard focus, copy feedback, responsive stacking, edit persistence, and honest weak-evidence copy. Capture any environment limitation explicitly in the PR.

- [ ] **Step 4: Commit the shipping record**

```bash
git add docs/changelog/entries/2026-07-20-506-one-send-ready-follow-up.md
git commit -m "docs: record send-ready follow-up (#506)"
```

- [ ] **Step 5: Push and open the PR**

Push `codex/506-send-ready-follow-up-implementation`, open a PR against `master`, add `codex` and `codex-automation`, then update #506 with behavior, verification, changed intent, and follow-ups.
