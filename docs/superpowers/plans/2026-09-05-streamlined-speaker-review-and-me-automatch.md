# Streamlined Speaker Identity Review and "Me" Automatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the speaker review experience into a sleek Notion/Linear-style interaction, clean up transcript header spacing and system clutter, and ensure microphone turns (`Me`) automatically bind to the user's configured Settings profile and display as `[Name] (You)`.

**Architecture:** 
1. `electron/commitmentIdentity.ts`: In local recordings, bind `Me` to the workspace `selfPersonId` without requiring capture-time presence or an arbitrary 0.85 acoustic diarization score. Exclude the user's name and aliases from remote attendee suggestions.
2. `src/components/features/meetingTranscriptPresentation.ts`: Project `Me` as `${name} (You)` when bound to the user.
3. `src/components/features/MeetingView.tsx`: Remove redundant `remoteSpeakerStatus` bordered banner and stacked divider lines.
4. `src/components/features/MeetingIdentityControls.tsx`: Replace native OS `<select>` dropdowns and `border-l-2` confirmation callouts with a compact Linear-style triage tray (mini audio player, 1-click attendee chips, sleek combobox) and instant Undo.
5. `src/index.css`: Style clean micro-player, suggestion chips, and Notion-like popover.

**Tech Stack:** React 18, Tailwind CSS, TypeScript, Electron IPC, better-sqlite3, Vitest, happy-dom.

---

### Task 1: Backend "Me" Automatch & Alias Roster Intelligence

**Files:**
- Modify: `electron/commitmentIdentity.ts`
- Modify: `tests/unit/commitmentIdentity.test.ts`
- Modify: `tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 1: Write failing unit tests for "Me" automatching**
  - Assert that `Me` binds to `workspaceSelfPersonId` even if `storedCapture.selfPersonId` was null at capture time.
  - Assert that `Me` binds without requiring acoustic diarization `confidence >= 0.85`.
  - Assert that calendar attendees whose names or aliases match the user's profile are excluded from candidate attendee suggestions.

- [ ] **Step 2: Run tests and verify RED**
  - Run: `pnpm exec vitest run tests/unit/commitmentIdentity.test.ts`

- [ ] **Step 3: Implement reliable "Me" binding in `commitmentIdentity.ts`**
  - Check `db.identityStore.getSelfPersonId()`.
  - If `nearEnd` exists (`speaker === 'Me'`) and `capture.origin === 'local'` (or meeting has local provenance) and `selfPersonId` is configured:
    Add binding for `Me` with `source: 'capture'` and `individual: true`.
  - Do not let missing acoustic diarization or low confidence block identifying the user on their own mic.

- [ ] **Step 4: Run tests and verify GREEN**
  - Run: `pnpm exec vitest run tests/unit/commitmentIdentity.test.ts`

- [ ] **Step 5: Commit**
  - `git commit -m "feat: automatch Me to workspace user profile"`

---

### Task 2: Clean Transcript Header Spacing & Display Name Projection

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/features/meetingTranscriptPresentation.ts`
- Modify: `src/index.css`
- Modify: `tests/unit/meetingTranscriptPresentation.test.ts`

- [ ] **Step 1: Write failing tests for `meetingTranscriptPresentation`**
  - Test that `applyMeetingSpeakerDisplayNames` appends `(You)` for `Me` when bound to the user.

- [ ] **Step 2: Implement display projection and verify GREEN**
  - Update `applyMeetingSpeakerDisplayNames` to format `Me` as `${displayName} (You)`.

- [ ] **Step 3: Remove `remoteSpeakerStatus` and stacked border rules in `MeetingView.tsx` and `src/index.css`**
  - Remove the standalone bordered banner.
  - Eliminate awkward stacked `border-b` and vertical margins.

- [ ] **Step 4: Verify test suite**
  - Run: `pnpm exec vitest run tests/unit/meetingTranscriptPresentation.test.ts`

- [ ] **Step 5: Commit**
  - `git commit -m "style: clean transcript header spacing and project user as (You)"`

---

### Task 3: Notion/Linear-Style Speaker Triage Component

**Files:**
- Modify: `src/components/features/MeetingIdentityControls.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests for new triage interactions**
  - Test mini audio player: clicking toggles play state and duration display.
  - Test 1-click suggestion chip: clicking directly assigns speaker and shows inline `Undo`.
  - Test that user's name and nicknames in `profile.aliases` are excluded from suggested attendees.
  - Test searchable custom combobox opens, filters people, and allows creating a new person.
  - Assert absence of `border-l-2` or native `<select>`.

- [ ] **Step 2: Run DOM tests and verify RED**
  - Run: `pnpm exec vitest run tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 3: Implement the compact triage UI in `MeetingIdentityControls.tsx`**
  - Build mini audio player with play/pause icons.
  - Replace `<select>` with custom dropdown / combobox.
  - Render quick 1-click attendee suggestion chips: `+ [Name]`.
  - Remove all-caps tracked labels and verbose disclaimer paragraphs.
  - Implement 1-click assignment with immediate inline Undo button.

- [ ] **Step 4: Update CSS in `src/index.css`**
  - Add clean styles adhering to Impeccable product register laws (OKLCH, restrained palette, no side-stripe borders).

- [ ] **Step 5: Verify DOM tests pass (GREEN)**
  - Run: `pnpm exec vitest run tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 6: Commit**
  - `git commit -m "feat: modern Notion/Linear speaker triage component"`

---

### Task 4: In-Transcript Direct Turn Tagging

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/features/MeetingIdentityControls.tsx`

- [ ] **Step 1: Wire turn speaker click affordance**
  - When a speaker is anonymous (e.g. `Speaker 1`), clicking the speaker label in any transcript row opens the assignment popover.
  - Selecting a person assigns that speaker for the entire meeting.

- [ ] **Step 2: Commit**
  - `git commit -m "feat: in-context speaker assignment from transcript turns"`

---

### Task 5: Full Verification & Documentation

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-05-758-streamlined-speaker-review-and-me-automatch.md`

- [ ] **Step 1: Record durable decision in `docs/decisions.md`**
  - Document that local mic speech (`Me`) is automatically bound to the workspace user without acoustic confidence thresholds.
- [ ] **Step 2: Add changelog fragment**
  - Create entry for Issue #758 and run `pnpm run changelog:check`.
- [ ] **Step 3: Run full verification suite**
  - `pnpm exec tsc --noEmit`
  - `pnpm run lint`
  - `pnpm test -- --run`
- [ ] **Step 4: Commit and update GitHub Issue #758**
