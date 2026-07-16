# Duplicate Capture Chunk Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject duplicate capture-journal delivery when the stored artifact no longer matches its acknowledged checksum.

**Architecture:** Keep duplicate handling inside `appendCaptureJournalChunk`. Reuse the existing SHA-256 helper to compare the stored artifact with the manifest checksum before returning the manifest unchanged.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest

---

### Task 1: Prove same-size corruption is rejected

**Files:**
- Modify: `tests/unit/captureJournal.test.ts`
- Modify: `electron/captureJournal.ts`

- [x] **Step 1: Write the failing test**

Add a test that appends `mic-bytes`, overwrites the stored chunk with same-size `bad-bytes`, redelivers `mic-bytes`, expects an artifact checksum mismatch, and confirms the manifest still has one entry.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`

Expected: FAIL because duplicate delivery currently checks only stored byte count.

- [x] **Step 3: Write minimal implementation**

Read the existing artifact in the duplicate branch, compute its SHA-256, and throw a checksum mismatch error when it differs from the manifest checksum.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/captureJournal.test.ts`

Expected: 6 tests pass.

- [x] **Step 5: Verify the repository slice**

Run `pnpm run changelog:check`, `pnpm run lint`, `pnpm run test -- --run`, and `git diff --check` before committing.
