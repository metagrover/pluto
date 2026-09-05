# Guided Speaker Identification Modal and Header Entry Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered in-transcript speaker accordion with a guided, one-by-one modal flow accessible from the meeting title metadata subtext.

**Architecture:** Create a focused `SpeakerIdentificationModal` that steps through unidentified remote speakers sequentially with quote excerpts, audio sample playback, 1-click attendee chips, and person selection. Connect it to the meeting header subtext in `MeetingView.tsx` and in-transcript turn labels, while removing the bulky accordion from the transcript record.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide icons, Vitest, Happy-DOM, SQLite / Electron IPC.

---

### Task 1: Create `SpeakerIdentificationModal` Component with One-by-One Wizard Flow

**Files:**
- Create: `src/components/features/SpeakerIdentificationModal.tsx`
- Test: `tests/unit/SpeakerIdentificationModal.dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests for `SpeakerIdentificationModal`**
  Cover:
  - Renders modal when open, steps through unidentified speakers sequentially (`Speaker 1 of 2`).
  - Displays quote excerpt and audio sample button.
  - Excludes workspace user and aliases from attendee suggestions.
  - 1-click attendee chip confirms and auto-advances to next speaker.
  - Skip advances to next speaker without binding.
  - Back returns to previous speaker.
  - Completion step displays reviewed summary and Done button.
  - Closes on Escape and close button.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `SpeakerIdentificationModal.tsx`**
  Implement the full modal dialog with Notion/Linear design tokens:
  - Fixed backdrop with blur (`bg-black/40 backdrop-blur-sm`).
  - Progress badge (`Speaker {index + 1} of {total}`).
  - Audio sample loading/playback with cleanup (`URL.revokeObjectURL`).
  - Filtered attendee chips (`userNames` exclusion).
  - Person search & "Create distinct person" input.
  - Navigation handlers (`onBack`, `onSkip`, `onConfirm`).
  - Escape key handling and focus management.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**
  Run: `git add src/components/features/SpeakerIdentificationModal.tsx tests/unit/SpeakerIdentificationModal.dom.test.tsx && git commit -m "feat: implement guided SpeakerIdentificationModal component"`

---

### Task 2: Integrate Subtext Entry Point and Clean Transcript in `MeetingView.tsx`

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/index.css`
- Test: `tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

- [ ] **Step 1: Add failing DOM test in `MeetingViewProgressiveReveal.dom.test.tsx`**
  Test that:
  - Meeting metadata subtext displays clickable unidentified speaker indicator when remote speakers exist.
  - Clicking the subtext indicator opens `SpeakerIdentificationModal`.
  - Clicking a `Speaker N` turn tag opens `SpeakerIdentificationModal` pre-focused on that speaker.
  - The bulky accordion is removed from above the transcript.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Update `MeetingView.tsx`**
  - Add `unidentifiedSpeakerCount` calculation or retrieve from identity state.
  - Add interactive indicator in `.meeting-document-meta` under the title.
  - Connect click to open modal.
  - Connect transcript row speaker tag click to open modal with `initialSpeaker`.
  - Remove `<MeetingIdentityControls>` accordion from above the transcript.
  - Render `<SpeakerIdentificationModal>` with all necessary props.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run tests/unit/MeetingViewProgressiveReveal.dom.test.tsx tests/unit/SpeakerIdentificationModal.dom.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**
  Run: `git add src/components/features/MeetingView.tsx src/index.css tests/unit/MeetingViewProgressiveReveal.dom.test.tsx && git commit -m "feat: add meeting header speaker review trigger and clean transcript view"`

---

### Task 3: Backward Compatibility, Decisions, and Changelog

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-05-759-guided-speaker-identification-modal.md`
- Test: Full unit and DOM test suites

- [ ] **Step 1: Run full test suite and verify no regressions**
  Run: `npx vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx tests/unit/IdentityControls.dom.test.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx tests/unit/commitmentIdentity.test.ts`
  Verify: 100% passing.

- [ ] **Step 2: Run Typecheck and Linter**
  Run: `npx tsc --noEmit && pnpm run lint`
  Verify: Zero errors, zero warnings.

- [ ] **Step 3: Record durable decision in `docs/decisions.md`**
  Document the choice to use a guided modal wizard launched from header subtext instead of inline transcript accordions.

- [ ] **Step 4: Add and validate changelog fragment**
  Run: `pnpm run changelog:check`

- [ ] **Step 5: Commit and update GitHub Issue #759**
  Run: `git commit -m "docs: record decision and changelog for guided speaker identification modal"`
  Post comment and close #759.
