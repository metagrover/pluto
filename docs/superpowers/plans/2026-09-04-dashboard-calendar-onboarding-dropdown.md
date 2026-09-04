# Dashboard Calendar Onboarding Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the onboarding calendar picker in the Dashboard's Upcoming Meetings rail from a tall, distracting block into a sleek single-line dropdown popover with instant toggle, while leaving the connected view and Settings page unchanged.

**Architecture:** Replace the static multi-line container in `UpcomingMeetings.tsx` (`needs_selection` / `selected_calendar_missing` state) with a compact trigger button and floating popover menu. Maintain open state until outside click or Escape, debounce/trigger `onSelectCalendars` on checkbox toggle, and guard against empty selection.

**Tech Stack:** React, Tailwind CSS, Lucide React (`ChevronDown`, `ChevronUp`), Vitest, happy-dom.

---

### Task 1: Update Tests for Single-Line Onboarding Dropdown

**Files:**
- Modify: `tests/unit/UpcomingMeetings.dom.test.tsx`

- [ ] **Step 1: Write the updated test cases**

Update `tests/unit/UpcomingMeetings.dom.test.tsx`:
1. Test that `UpcomingMeetings` in `needs_selection` state renders a single-line trigger button (`Choose calendars`) with `ChevronDown` and `aria-expanded="false"`.
2. Test that clicking the trigger button opens the floating popover (`role="menu"` or list of calendars) with `aria-expanded="true"`.
3. Test that checking calendars in the popover calls `onSelectCalendars` with the selected calendar descriptor array.
4. Test that pressing `Escape` or clicking outside closes the popover.
5. Verify connected state retains the agenda rows and footer with `Change` button.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/UpcomingMeetings.dom.test.tsx`
Expected: FAIL (trigger button and popover not yet implemented).

---

### Task 2: Implement Single-Line Dropdown in UpcomingMeetings

**Files:**
- Modify: `src/components/features/UpcomingMeetings.tsx`

- [ ] **Step 1: Add state and ref for dropdown in UpcomingMeetings**

Add `isDropdownOpen`, `dropdownRef`, outside-click and Escape key listeners, and track onboarding completion.

- [ ] **Step 2: Implement instant toggle handler**

Implement `handleToggleAndCommit` that updates `checkedIds`, prevents unchecking the last remaining calendar, and calls `onSelectCalendars(chosen)`.

- [ ] **Step 3: Render single-line trigger and floating popover**

Replace the static `needs_selection` / `selected_calendar_missing` markup with:
- Trigger button with `min-h-9`, `border-pro-border/70`, `bg-pro-surface/50`, label, and `ChevronDown`/`ChevronUp`.
- Absolute-positioned floating popover (`z-30 mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-pro-border/70 bg-pro-bg shadow-lg`).
- Checkbox rows with color dot, title, source subtitle.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/UpcomingMeetings.dom.test.tsx`
Expected: PASS.

---

### Task 3: Full Project Verification & Quality Checks

**Files:**
- Run: `pnpm test` (all unit and DOM tests)
- Run: `pnpm exec tsc --noEmit`
- Run: `pnpm run check` (Biome lint and format)

- [ ] **Step 1: Run typecheck**
- [ ] **Step 2: Run lint check**
- [ ] **Step 3: Run full test suite**

