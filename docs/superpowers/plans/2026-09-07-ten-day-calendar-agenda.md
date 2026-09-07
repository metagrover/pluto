# Ten-day Calendar Agenda Implementation Plan

**Issue:** [#785](https://github.com/metagrover/pluto/issues/785)

**Goal:** Reliably show a useful upcoming agenda without truncating today's remaining schedule.

**Architecture:** Keep the calendar service's selected-calendar synchronization intact. Refresh once during renderer startup, query a bounded 10-day dashboard range, and let `UpcomingMeetings` choose its collapsed rows according to whether today has any remaining events.

- [x] Add regression coverage for compact and large future limits.
- [x] Add regression coverage proving all remaining meetings today stay visible.
- [x] Reduce the dashboard query to 10 local days and its IPC boundary to 12 elapsed days for timezone-transition tolerance.
- [x] Refresh the calendar before the initial dashboard cache read, preserving cached fallback behavior.
- [x] Record the revised product and privacy boundaries in the issue, decision log, and changelog fragment.
- [x] Run focused tests, the full test suite, type checks, lint, changelog validation, and whitespace validation.
