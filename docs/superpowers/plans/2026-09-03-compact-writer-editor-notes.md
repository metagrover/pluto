# Compact Writer and Editor Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct meeting notes use one compact writer call and one complete-document editor call, with no model repair, merge, or repartition calls.

**Architecture:** Reuse the existing compact writer parser and complete-document editor. Capacity-plan the pair as a direct operation; if it does not fit, delegate to the unchanged legacy hierarchy. Product callers select the compact pair by default, while explicit benchmark options remain available.

**Tech Stack:** TypeScript, Electron, Vitest, Ollama-compatible structured generation.

---

### Task 1: Lock the direct two-call contract

**Files:**
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `tests/unit/meetingNotesEditor.test.ts`

- [x] **Step 1: Write the failing direct-path test**

Add a test that invokes `generateMeetingNotes` with
`reviewProtocol: 'editor'` and `compactWriterContract: true`. Return a compact
draft from the first generated request and a complete editor document from the
second. Assert:

```ts
expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
  'notesWriter',
  'notesAudit',
]);
expect(generate.mock.calls.map(([request]) => request.responseContract)).toEqual([
  'compact_draft',
  'editor',
]);
expect(onRepair).not.toHaveBeenCalled();
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts
```

Expected: failure with `notes_compact_writer_requires_deterministic_only`.

- [x] **Step 3: Permit the compact writer/editor pair**

In `electron/llm/meetingNotesPipeline.ts`, treat
`compactWriterContract && reviewProtocol === 'editor'` as a supported direct
pair. Use `COMPACT_WRITER_OUTPUT_TOKENS` in capacity planning and feed the
expanded compact draft to the existing `auditDraft` editor route.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesEditor.test.ts
```

Expected: both files pass.

### Task 2: Remove direct-path model repair

**Files:**
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `electron/llm/meetingNotesPipeline.ts`

- [x] **Step 1: Write failing malformed-response tests**

Add separate tests for malformed compact writer output and malformed editor
output. Each generator throws or returns invalid JSON on the relevant call.
Assert the operation rejects with the existing writer or audit failure code and:

```ts
expect(onRepair).not.toHaveBeenCalled();
expect(generate).toHaveBeenCalledTimes(expectedCalls);
```

Use `expectedCalls = 1` for writer failure and `expectedCalls = 2` for editor
failure.

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts
```

Expected: the current repair helper makes an additional model call.

- [x] **Step 3: Add a one-attempt parse path**

Extend `withOneRepair` with an `allowModelRepair` parameter that defaults to
`true`. After the first parser failure, use:

```ts
if (!allowModelRepair) throw new MeetingNotesError(failureCode);
```

Pass `false` from compact writer/editor direct stages. Preserve existing
hierarchy and benchmark behavior.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesAuditRepair.test.ts tests/unit/meetingNotesTruncationRecovery.test.ts
```

Expected: direct no-repair tests and legacy recovery tests pass.

### Task 3: Preserve the long-meeting compatibility path

**Files:**
- Modify: `tests/unit/meetingNotesPipeline.test.ts`
- Modify: `electron/llm/meetingNotesPipeline.ts`

- [x] **Step 1: Write the failing oversized-input test**

Force capacity planning to choose hierarchy while passing the compact
writer/editor pair. Assert the first hierarchy writer request uses:

```ts
expect(request.responseContract).toBe('draft');
```

and that the existing hierarchy audit protocol remains unchanged.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts
```

Expected: hierarchy incorrectly inherits the compact direct contract.

- [x] **Step 3: Strip direct-only options before hierarchy**

When the compact pair does not fit, call `runHierarchy` with a copied input
whose `compactWriterContract` and `reviewProtocol` are unset. Do not change
hierarchy prompts, retries, merges, or validation.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: direct and hierarchy routing tests pass.

### Task 4: Promote the pair for product calls

**Files:**
- Modify: `tests/unit/meetingNotesProviderRouting.test.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `electron/llm/provider.ts`
- Modify: `electron/llm/meetingNotesTypes.ts`

- [x] **Step 1: Write the failing provider-routing test**

Call `generateStructuredAnalysis` without experimental options and assert the
generated direct requests use:

```ts
expect(contracts).toEqual(['compact_draft', 'editor']);
```

Also retain a test that explicit deterministic-only benchmark routing makes one
writer call.

- [x] **Step 2: Run the provider test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesProviderRouting.test.ts
```

Expected: the default contracts are `draft` and `audit`.

- [x] **Step 3: Set product defaults**

In `UnifiedLLMProvider.generateStructuredAnalysis`, pass
`reviewProtocol: 'editor'` and `compactWriterContract: true` when no explicit
benchmark strategy overrides the route. Update comments that still describe the
contracts as benchmark-only.

- [x] **Step 4: Run routing and semantic tests**

Run:

```bash
pnpm exec vitest run tests/unit/meetingNotesProviderRouting.test.ts tests/unit/meetingNotesEditor.test.ts tests/unit/meetingNotesEditorCases.test.ts
```

Expected: all files pass.

### Task 5: Record and verify the shipped decision

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-03-739-compact-writer-editor.md`

- [x] **Step 1: Add the durable decision**

Record that direct notes use a compact writer plus complete-document editor,
both on the configured model; code remains mechanical; direct model repair and
merge loops are removed; oversized meetings retain the existing hierarchy for
this iteration.

- [x] **Step 2: Add the changelog fragment**

Describe the user-visible outcome: bounded direct note generation with retained
source and publication safeguards.

- [x] **Step 3: Run complete verification**

Run:

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
pnpm run audit:high
```

Expected: all commands exit zero.

- [x] **Step 4: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors and only #739 files are changed.
