# Meeting Name Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the active recording name popover for issue #611, including voice dots, expand, and a back-home escape from Zen View.

**Architecture:** Introduce a focused `RecordingNamePopover` component that owns the floating pill when recording continues behind the home dashboard. Keep `RecordingCaptureBar` responsible for capture status, the inline back-home action, and finish controls. Wire `ZenMode` to render the back button through the capture bar, with shell visibility owned by `App`.

**Tech Stack:** React 18, TypeScript, lucide-react, Tailwind component classes in `src/index.css`, Vitest with server-rendered and happy-dom component tests.

---

### Task 1: Component Contract Tests

**Files:**
- Modify: `tests/unit/RecordingWorkspaceComponents.test.tsx`
- Create: `src/components/features/RecordingNamePopover.tsx`
- Modify: `src/components/features/RecordingCaptureBar.tsx`

- [ ] **Step 1: Write failing popover and capture bar tests**

Add tests that import `RecordingNamePopover`, render the empty and named title cases, verify the voice activity semantics, verify the expand button exists, and assert `RecordingCaptureBar` no longer renders the inline `Meeting title` input.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: FAIL because `RecordingNamePopover` does not exist and the capture bar still renders the inline title input.

- [ ] **Step 3: Implement minimal component contract**

Create `RecordingNamePopover.tsx` with props for `title`, `onTitleChange`, `voiceActivity`, `disabled`, and `onExpand`. Update `RecordingCaptureBar` props to remove `title` and `onTitleChange`.

- [ ] **Step 4: Run the focused test and verify green**

Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: PASS.

### Task 2: Zen View Wiring

**Files:**
- Modify: `src/components/features/ZenMode.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/features/RecordingMeetingRail.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/RecordingWorkspaceComponents.test.tsx`

- [ ] **Step 1: Write failing ZenMode render test**

Add a test that renders `ZenMode` and verifies it includes a `Back home` button inside the recording chrome while the name popover is not shown.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: FAIL because `ZenMode` still renders the popover and the capture bar does not render the inline back button yet.

- [ ] **Step 3: Wire ZenMode**

Add an `onBackHome` prop to `ZenMode` and pass it into `RecordingCaptureBar`. Do not render `RecordingNamePopover` while Zen View is open.

- [ ] **Step 4: Wire App state**

Add a `zenVisible` state. Set it true when recording starts. Back home sets `zenVisible` false, clears `selectedMeetingId`, and sets `activeTab` to `hub`. While recording continues with `zenVisible` false, render the normal shell and keep the active recording popover visible.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: PASS.

### Task 3: Verification

**Files:**
- Modify: `docs/changelog/entries/2026-08-12-meeting-name-popover.md`

- [ ] **Step 1: Add changelog fragment**

Add a fragment explaining that active recordings now expose a top-center note/meeting pill and a back-home path from Zen View.

- [ ] **Step 2: Run verification**

Run:

```bash
pnpm vitest run tests/unit/RecordingWorkspaceComponents.test.tsx
pnpm run changelog:check
pnpm run lint
```

Expected: all commands pass.
