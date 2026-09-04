# Recording Back Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the recording Back control with the macOS traffic-light row.

**Architecture:** Keep the existing capture-bar DOM and titlebar safe inset. Refine the Back control into a compact accessible icon and express desktop versus compact vertical alignment in the existing stylesheet.

**Tech Stack:** React, CSS/Tailwind `@apply`, PostCSS, Vitest

---

### Task 1: Lock the titlebar geometry

**Files:**
- Modify: `tests/unit/recordingCaptureBarStyles.test.ts`
- Modify: `src/components/features/RecordingCaptureBar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing style assertions**

Require `.recording-back-home` to use 32-pixel square icon geometry, centered content, and an absolute desktop titlebar position. Require its `max-width: 980px` rule to follow the narrower safe inset.

- [ ] **Step 2: Verify the regression fails**

Run `pnpm exec vitest run tests/unit/recordingCaptureBarStyles.test.ts`. Expect failure because the current control is a 40-pixel text pill with no titlebar offset.

- [ ] **Step 3: Make the minimal component and CSS changes**

Give the button `aria-label` and `title` values of `Back home`, retain a screen-reader-only label, and style it as a quiet 32-pixel icon button positioned on the traffic-light axis. Reserve space before the recording status and move only the horizontal anchor at the compact breakpoint.

- [ ] **Step 4: Verify styling and interaction**

Run `pnpm exec vitest run tests/unit/recordingCaptureBarStyles.test.ts tests/unit/RecordingWorkspaceComponents.test.tsx tests/unit/AppRecordingNavigation.dom.test.tsx`. Expect all tests to pass.

- [ ] **Step 5: Commit the focused UI fix**

Stage only the component, stylesheet, and related tests and commit with `fix(recording): align back control with macOS chrome`.
