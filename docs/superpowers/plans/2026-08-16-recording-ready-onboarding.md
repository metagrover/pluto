# Recording-ready onboarding implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh packaged Pluto install reliably reach a truthful, local recording-ready state through a short onboarding flow.

**Architecture:** Keep native binaries in the signed application bundle and large model assets in Pluto's user-data directory. The Electron main process owns model preparation and permission APIs; the renderer presents a two-stage welcome/readiness flow backed by a small pure readiness model. Existing users retain their settings, while first-run users no longer wait behind an invisible model download or Python check.

**Tech Stack:** Electron Builder, Electron IPC, React, TypeScript, Vitest, Swift/Core ML Parakeet runtime.

---

### Task 1: Enforce the packaged-runtime contract

**Files:**
- Create: `scripts/verify_packaged_runtime.mjs`
- Create: `tests/unit/packagedRuntimeResources.test.ts`
- Modify: `electron-builder.json5`
- Modify: `package.json`

- [ ] Write a failing unit test that checks the builder configuration exports `recorder`, `audiocap`, `parakeet-runtime`, `parakeet-resource-probe`, and the `mlx_transcription_server` directory to `Resources/bin`.
- [ ] Run `pnpm exec vitest run tests/unit/packagedRuntimeResources.test.ts` and verify it fails on the missing resources.
- [ ] Expand `extraResources` to copy the complete generated `resources/bin` tree and add a reusable verifier that checks the exact packaged executable paths and executable bits.
- [ ] Add `package:verify-runtime` and run the focused test again until it passes.

### Task 2: Define deterministic setup readiness

**Files:**
- Create: `src/services/setupReadiness.ts`
- Create: `tests/unit/setupReadiness.test.ts`

- [ ] Write failing tests for `checking`, `preparing`, `ready`, `blocked`, and retryable states, including the rule that analysis-provider choice is not part of recording readiness.
- [ ] Run the focused test and verify the missing implementation failure.
- [ ] Implement the smallest typed readiness reducer and derived primary-action model.
- [ ] Re-run the focused test until it passes.

### Task 3: Make model preparation explicit and first-run safe

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/transcription/finalTranscriptionStartup.ts`
- Modify: `tests/unit/finalTranscriptionStartup.test.ts`

- [ ] Add failing tests proving first-run startup does not begin the large Parakeet download and returning-user startup still prepares before capture recovery.
- [ ] Run the focused test and verify the first-run case fails.
- [ ] Gate startup preparation on persisted `setup_complete`, leaving explicit `TRANSCRIPTION_PREPARE_FINAL` as the onboarding-owned download/retry command.
- [ ] Remove the unconditional pre-window microphone prompt so onboarding owns the permission request.
- [ ] Re-run the focused test until it passes.

### Task 4: Replace the four-screen setup ceremony

**Files:**
- Modify: `src/components/Setup/SetupWizard.tsx`
- Create: `tests/unit/SetupWizard.dom.test.tsx`

- [ ] Write failing DOM tests for the welcome screen, the single readiness screen, automatic Parakeet preparation, permission actions, retry, and completion only after the local transcription model is ready.
- [ ] Run the focused DOM test and verify the current Python/provider screens fail the contract.
- [ ] Implement the approved two-stage flow using the readiness service, existing Pluto tokens, clear local/private copy, an indeterminate preparation bar, and concise actionable failures.
- [ ] Persist `setup_complete` only from a genuinely ready state; keep analysis-provider selection in Settings.
- [ ] Re-run the DOM and readiness tests until they pass.

### Task 5: Record and verify the shipped change

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-16-recording-ready-onboarding.md`

- [ ] Record the durable decision that executables ship with the app while large verified models live in user data and are prepared through onboarding.
- [ ] Add a content-free changelog fragment tied to #615.
- [ ] Run focused tests, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run changelog:check`, and the complete Vitest suite.
- [ ] Build native resources, build the unpacked application, and run `pnpm run package:verify-runtime` against the resulting app bundle.
- [ ] Inspect the final diff for scope, privacy, and generated artifacts before committing.
