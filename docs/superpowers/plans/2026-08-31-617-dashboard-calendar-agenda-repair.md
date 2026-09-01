# Dashboard Calendar Agenda Repair Implementation Plan

**Goal:** Repair native event decoding and simplify the Upcoming meetings hierarchy without expanding the dashboard footprint.

## Task 1: Freeze the native response regression

- Add a calendar protocol test where optional event and person fields are omitted.
- Assert that parsing succeeds and returns explicit nulls.
- Run the focused protocol test and confirm it fails before implementation.

## Task 2: Normalize optional native fields

- Replace the boolean-only event guard with a small parser that keeps required fields strict and normalizes absent optional values.
- Preserve the existing `CalendarEvent` contract for downstream storage and UI code.
- Rerun protocol and calendar service tests.

## Task 3: Refine the agenda hierarchy

- Add DOM assertions for a single-line heading, no event dividers, source metadata below content, long-name truncation, and calendar-specific recovery copy.
- Remove the heading-row source badge and row divider classes.
- Use tighter grouping within rows and spacing between rows; keep exactly two meetings before `See more`.
- Add a compact source/footer action using the existing Settings callback.

## Task 4: Verify and deliver

- Run focused Vitest, Swift tests, TypeScript, and Biome on touched files.
- Run the broader test/build checks warranted by the shared protocol change.
- Rebuild and inspect the running Dashboard with the selected live calendar.
- Update issue #617 and the existing changelog fragment with verified results.
