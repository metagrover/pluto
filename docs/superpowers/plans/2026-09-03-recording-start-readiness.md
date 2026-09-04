# Recording Start Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue one recording-start attempt through Parakeet idle re-preparation.

**Architecture:** Reuse the existing main-process preparation IPC and its single-flight Parakeet client. Keep renderer lifecycle ownership unchanged so readiness completes before journal acquisition and capture begins.

**Tech Stack:** React, Electron IPC, TypeScript, Vitest

---

### Task 1: Require preparation in recording admission

**Files:**
- Modify: `tests/unit/audioManagerParakeetEouWiring.test.ts`
- Modify: `src/components/AudioManager.tsx`

- [ ] **Step 1: Write the failing boundary assertion**

Update the startup-order tests to locate `RECORDING_READINESS_PREPARE`, require it after `onStartingChange?.(true)`, and reject `RECORDING_READINESS_STATUS` inside `startSession`.

- [ ] **Step 2: Verify the regression fails**

Run `pnpm exec vitest run tests/unit/audioManagerParakeetEouWiring.test.ts`. Expect failure because recording admission still invokes `RECORDING_READINESS_STATUS`.

- [ ] **Step 3: Make the minimal implementation**

Change the readiness IPC invoked by `startSession` from `RECORDING_READINESS_STATUS` to `RECORDING_READINESS_PREPARE`. Preserve the existing blocker result, readiness-failed event, lifecycle transitions, and error handling.

- [ ] **Step 4: Verify focused behavior**

Run `pnpm exec vitest run tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/parakeetFinalClient.test.ts tests/unit/recordingReadiness.test.ts tests/unit/RuntimeReadinessGate.dom.test.tsx`. Expect all tests to pass.

- [ ] **Step 5: Commit the focused fix**

Stage only the two implementation/test files and commit with `fix(recording): warm Parakeet during meeting start`.

