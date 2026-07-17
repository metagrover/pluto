# Capture Journal Durable Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make capture-journal acknowledgement wait for stable-storage synchronization of chunk and manifest updates.

**Architecture:** Keep the existing temp-file-plus-rename transaction shape, but add a small injected durability boundary with production defaults backed by `FileHandle.sync()`. Sync each temp file before rename and its containing directory after rename; thread the same boundary through create, append, and seal so tests can fault-inject sync failures without mocking Node internals.

**Tech Stack:** TypeScript, Node `fs/promises`, Vitest.

---

### Task 1: Durable capture-journal persistence

**Files:**
- Modify: `electron/captureJournal.ts`
- Modify: `tests/unit/captureJournal.test.ts`
- Create: `docs/changelog/entries/2026-07-16-503-capture-journal-durable-sync.md`

- [ ] **Step 1: Write the failing tests**

Add focused tests that inject file and directory sync callbacks, assert both the chunk and manifest are synced before append resolves, and assert a sync rejection prevents acknowledgement.

- [ ] **Step 2: Run the tests to verify RED**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`
Expected: FAIL because capture-journal APIs do not accept or invoke a durability boundary.

- [ ] **Step 3: Implement minimal durable writes**

Add production `syncPath` behavior using `open(path, 'r')`, `FileHandle.sync()`, and `FileHandle.close()`. Sync temp files before rename and parent directories after rename, and pass the optional durability dependency through create, append, and seal.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`
Expected: PASS with the new durability and fault-injection cases.

- [ ] **Step 5: Record and verify the shipped behavior**

Add the issue-scoped changelog fragment, then run `pnpm run changelog:check`, `pnpm run lint`, `pnpm run test -- --run`, and `git diff --check`.
