# Dashboard Calendar Agenda Repair

## Goal

Make Upcoming meetings read as one calm agenda in the Dashboard rail and restore successful reads from the selected local calendar.

## Approved layout

- Keep `Upcoming meetings` on one line with a compact heading that remains subordinate to Today’s focus.
- Remove the truncated calendar name from the heading row.
- Present meeting rows as a spaced agenda without horizontal dividers. Time, title, and duration remain the only event details in the rail.
- Put the selected source in quiet metadata beneath the agenda, with a `Change` action that opens the existing maintenance surface.
- Keep setup, empty, permission, and read-recovery states inside the same Dashboard section.
- In the read-failure state, identify the affected calendar and offer one compact `Try again` action.

Long calendar names must truncate in the metadata row without forcing the heading or action off-screen. Existing keyboard labels, focus treatment, and two-meeting disclosure behavior remain intact.

## Reliability contract

Swift’s synthesized `Codable` output omits optional event fields when they are nil. The TypeScript boundary must accept an omitted optional field and normalize it to the public `CalendarEvent` shape with explicit nulls. Missing `organizer`, `availability`, `lastModified`, or optional person fields must not invalidate an otherwise valid event response. Required identifiers, dates, booleans, titles, and attendee arrays remain strict.

## Scope

- Preserve native macOS EventKit, one-calendar, local-only, read-only behavior.
- Do not add a calendar screen, card, timeline, attendee treatment, or new navigation.
- Do not alter Calendar permission behavior or persisted event fields.
- Add protocol and DOM regression coverage before implementation.

## Verification

Prove the decoder accepts the live organizer-free response shape, prove the right rail has a single-line heading and divider-free agenda with subordinate source metadata, then run focused tests, TypeScript, formatting, native tests, packaging checks, and a rebuilt-app acceptance pass.
