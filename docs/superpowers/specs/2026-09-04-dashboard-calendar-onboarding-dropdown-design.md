# Dashboard Calendar Onboarding Dropdown

## Goal

Provide a minimal, single-line dropdown for choosing calendars during onboarding on the Dashboard's **Upcoming meetings** rail, replacing the tall, distracting checkbox list while leaving the post-onboarding connected view and Settings page completely unchanged.

## Context & Problem

In #617, Pluto added multi-calendar support. During the first-run onboarding state (`needs_selection` / `selected_calendar_missing`), `UpcomingMeetings` in the dashboard sidebar currently renders an expanded block containing headings, multiple calendar checkbox rows (taking 200+ px), and a blue submit button. This is visually noisy and distracting on the dashboard.

In contrast, the Settings page (`CalendarSettings.tsx`) already has a full, well-organized management interface. On the dashboard, the user wants a minimal, single-line experience during onboarding.

## User Flow

1. **First-run Permission**: The user connects calendar access as usual.
2. **Onboarding Selection (`needs_selection` / `selected_calendar_missing`)**:
   - The rail displays a single compact row: `[ Choose calendars ▾ ]`.
   - Clicking this row opens a floating dropdown popover directly underneath.
   - The dropdown lists the available calendars with checkboxes, color dots, and account source subtitles.
   - Checking or unchecking calendars instantly persists the selection (`onSelectCalendars`) without requiring a separate "Use selected calendars" button.
   - The popover closes on clicking outside or pressing `Escape`.
3. **Active Connected State (Unchanged)**:
   - Once $\ge 1$ calendar is selected, `UpcomingMeetings` displays the agenda rows (or "No more meetings today") and the quiet footer:
     `{N} calendars · Change` (or `{Title} · {Source} · Change`).
   - Clicking **Change** continues to navigate directly to Settings → Meetings.

## Component & Interaction Details

### `src/components/features/UpcomingMeetings.tsx`

- **Dropdown Trigger**:
  - Rendered when `snapshot.state === 'needs_selection'` or `'selected_calendar_missing'`.
  - Single-line button (`min-h-9`, rounded, `border-pro-border/70`, `bg-pro-surface/50`, hover transition).
  - Label: `"Choose calendars"` (or `"Choose another calendar"` if `selected_calendar_missing`).
  - Trailing icon: `ChevronDown` (rotates or flips to `ChevronUp` when open).
  - ARIA attributes: `aria-haspopup="true"`, `aria-expanded={isOpen}`.
- **Floating Popover**:
  - Rendered in a relative container with absolute positioning (`top-full mt-1.5 left-0 right-0 z-30`).
  - Styling: `rounded-lg border border-pro-border/70 bg-pro-bg shadow-lg overflow-hidden max-h-60 overflow-y-auto`.
  - Calendar rows: `min-h-10 px-3 py-2 flex items-center gap-2.5 hover:bg-pro-surface cursor-pointer`.
  - Toggling an item updates `checkedIds` and immediately calls `onSelectCalendars`.
  - Guard: Prevents deselecting the last remaining item to ensure valid selection state.
  - Document click listener (`pointerdown`) and `Escape` key listener for closing the popover.
  - Inline error alert if commit fails.

## Verification

- Vitest DOM tests in `tests/unit/UpcomingMeetings.dom.test.tsx`:
  - Verify single-line trigger renders on initial `needs_selection`.
  - Verify clicking trigger opens floating dropdown popover.
  - Verify toggling checkbox in popover calls `onSelectCalendars` instantly.
  - Verify clicking outside or pressing Escape closes popover.
  - Verify post-onboarding agenda and "Change" button remain identical.
- Type check: `pnpm exec tsc --noEmit`.
- Lint & format check: `pnpm run check`.
