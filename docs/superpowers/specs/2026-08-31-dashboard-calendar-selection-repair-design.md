# Dashboard Calendar Selection Repair

## Goal

Let a person choose their one local macOS calendar without leaving the Dashboard, and preserve that choice when the first event refresh is unavailable.

## User flow

The Dashboard’s **Upcoming meetings** rail remains the only first-run calendar surface. After Calendar permission is granted, its compact empty state becomes an in-place list of the calendars available on the Mac. Selecting a row keeps the user on the Dashboard, records that calendar, and returns the rail to its ordinary upcoming-meetings state.

Settings remains a maintenance surface for changing, refreshing, or disconnecting an existing calendar. It is not used to complete initial selection.

## Reliability contract

The EventKit helper must parse the exact ISO-8601 timestamps emitted by JavaScript, including fractional seconds. A selected calendar is durable before Pluto reads events. If that first read fails, the app reports the selected calendar and a bounded retry action; it must not report the calendar selection itself as failed.

## Scope and constraints

- Retain one-calendar, native macOS EventKit, local-only, read-only behavior.
- Preserve the compact right-rail footprint, no modal, route change, or new destination.
- Keep denied and no-calendar recovery actions opening the relevant macOS settings pages.
- Add regression coverage for fractional-second timestamps, dashboard selection, and selection-with-refresh-failure behavior.
- Do not alter unrelated settings, calendar maintenance, or dashboard content.

## Verification

Run the focused Swift and Vitest tests first, then TypeScript and targeted formatting checks. Finally, exercise the dashboard preview or running Electron app: permission → choose a calendar → upcoming meetings, plus the recoverable initial-read failure state.
