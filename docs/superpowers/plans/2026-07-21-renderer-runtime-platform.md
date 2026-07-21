# Renderer Runtime Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Node-global renderer crash while preserving truthful transcription capability decisions.

**Architecture:** Define and normalize one small runtime descriptor in the shared transcription backend module. Electron preload and browser QA expose immutable descriptors at their trusted boundaries; shared capability functions resolve evidence lazily and never dereference `process` at module evaluation.

**Tech Stack:** TypeScript, Electron contextBridge, React/Vite browser bootstrap, Vitest, headless Chromium renderer QA.

---

### Task 1: Process-free transcription capability resolution

**Files:**
- Modify: `tests/unit/transcriptionBackend.test.ts`
- Modify: `src/utils/transcriptionBackendConfig.ts`

- [ ] Add failing tests for explicit Darwin/arm64 availability, macOS/unknown fail-closed behavior, Linux CUDA hints, and invalid runtime normalization.
- [ ] Run `pnpm exec vitest run tests/unit/transcriptionBackend.test.ts` and confirm failures because functions do not accept runtime evidence.
- [ ] Add `PlutoRuntimePlatform`, normalization, guarded lazy runtime resolution, and optional runtime parameters to capability/list/option functions. Remove module-scope `process` reads.
- [ ] Rerun the focused test and confirm it passes.
- [ ] Commit `feat: make transcription capabilities process-free (#536)`.

### Task 2: Trusted preload and browser boundaries

**Files:**
- Modify: `tests/unit/transcriptionBackend.test.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/electron-env.d.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/utils/browserIpcFallback.ts`

- [ ] Add failing source-contract tests proving preload exposes a frozen normalized runtime descriptor and browser fallback installs unknown architecture without broad Node exposure.
- [ ] Run the focused test and confirm the new assertions fail.
- [ ] Expose `plutoRuntimePlatform` through preload using allowlisted `process.platform/process.arch`; define renderer types; install a frozen browser descriptor before the IPC early return.
- [ ] Rerun focused tests and confirm they pass.
- [ ] Commit `fix: expose safe renderer runtime evidence (#536)`.

### Task 3: Startup regression, documentation, and delivery

**Files:**
- Modify: `tests/unit/transcriptionBackend.test.ts`
- Modify: `docs/changelog/entries/2026-07-21-536-renderer-runtime-platform-design.md`

- [ ] Add a regression assertion that the shared module contains no unguarded module-scope `process.platform/process.arch` reads and preserves explicit capability behavior.
- [ ] Run focused tests, then start `pnpm run dev` and load the Vite renderer in headless Chromium.
- [ ] Assert the captured DOM has a non-empty `#root` and Chromium logs contain no `process is not defined` exception.
- [ ] Update the #536 changelog from design to delivered runtime behavior.
- [ ] Run `pnpm run changelog:check`, `pnpm run lint`, `pnpm run test -- --run`, `pnpm run audit:high`, and `git diff --check`.
- [ ] Push, open an implementation PR against `master`, add `codex` and `codex-automation`, update #536, and preserve the worktree for review.
