# Auto-End System-Audio Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pluto actually probe meeting-app system audio during recording so auto-end can observe hangup and start its existing grace timer.

**Architecture:** Keep native-capture lifecycle policy in `electron/nativeAudioCapture.ts` and call it from the existing `runAudioProbe` boundary in `electron/main.ts`. A pure policy test captures the production regression without starting Electron or accessing real meeting audio.

**Tech Stack:** TypeScript, Electron, Vitest, AudioCap

---

### Task 1: Guard the capture fast path

**Files:**
- Modify: `electron/nativeAudioCapture.ts`
- Modify: `electron/main.ts:26,516-545`
- Test: `tests/unit/nativeAudioCapture.test.ts`

- [ ] **Step 1: Write the failing regression test**

Import `canReuseRunningCaptureForProbe` and assert that a running capture cannot satisfy `{ targetPids: [123] }`, while it can satisfy an untargeted probe.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/nativeAudioCapture.test.ts`

Expected: FAIL because `canReuseRunningCaptureForProbe` is not exported.

- [ ] **Step 3: Implement the minimal policy**

Add `canReuseRunningCaptureForProbe(captureRunning, targetPids)` to return true only when capture is running and no valid positive integer target PID exists. Replace `if (nativeAudioProcess) return true` in `runAudioProbe` with the policy call.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/nativeAudioCapture.test.ts tests/unit/activeCallDetector.test.ts tests/unit/autoEndDecision.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit the TDD implementation**

Commit the test and production changes with issue traceability.

### Task 2: Record and verify delivery

**Files:**
- Create: `docs/changelog/entries/2026-07-22-541-auto-end-system-audio.md`

- [ ] **Step 1: Add the changelog fragment**

Record issue #541, the eventual PR, the targeted-probe correction, why capture-process existence was insufficient, and the replaced behavior.

- [ ] **Step 2: Run verification**

Run:

```bash
pnpm exec biome check electron/main.ts electron/nativeAudioCapture.ts tests/unit/nativeAudioCapture.test.ts
pnpm run changelog:check
pnpm run test
git diff --check
```

Expected: every command exits zero and the full suite reports zero failures.

- [ ] **Step 3: Commit, push, and open the PR**

Commit the changelog, push `codex/541-auto-end-system-audio`, open a focused PR closing #541, then update the fragment with the PR link and push that commit.
