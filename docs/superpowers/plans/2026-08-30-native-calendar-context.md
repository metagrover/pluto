# Native Calendar Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click, read-only native macOS Calendar context to Pluto, led by a compact two-meeting Dashboard agenda.

**Architecture:** A dependency-free Swift EventKit helper exposes a bounded JSON-lines read protocol. Electron supervises and validates the helper, stores a minimized rolling snapshot in SQLite, associates meetings deterministically from the cache, and exposes a typed IPC API. React consumes that API for the approved Dashboard rail and detailed Settings recovery/selection states.

**Tech Stack:** Swift 6/EventKit, Electron/Node child processes, TypeScript, better-sqlite3, React 18, Vitest, Biome, electron-builder.

---

### Task 1: Native EventKit helper

**Files:**
- Create: `native/calendar-helper/Package.swift`
- Create: `native/calendar-helper/Sources/CalendarBridgeCore/CalendarBridgeCore.swift`
- Create: `native/calendar-helper/Sources/PlutoCalendarHelper/main.swift`
- Create: `native/calendar-helper/Tests/CalendarBridgeCoreTests/CalendarBridgeCoreTests.swift`
- Create: `resources/calendar-helper/Info.plist`
- Modify: `package.json`

- [ ] Write Swift tests for request decoding, bounded windows, calendar filtering, normalized occurrences, forbidden-field omission, stable recurring keys, and mutation-method rejection.
- [ ] Run `swift test --package-path native/calendar-helper` and verify the tests fail because the bridge core is absent.
- [ ] Implement the allowlisted `authorization_status`, `request_access`, `list_calendars`, and `list_events` protocol behind a testable EventKit adapter.
- [ ] Run the Swift suite and verify it passes.
- [ ] Add `build:calendar-helper` and include it in `build-native`; build an executable with the Calendar usage description bundled beside it.

### Task 2: Validated Electron protocol and deterministic matching

**Files:**
- Create: `electron/calendar/types.ts`
- Create: `electron/calendar/protocol.ts`
- Create: `electron/calendar/matcher.ts`
- Create: `tests/unit/calendarProtocol.test.ts`
- Create: `tests/unit/calendarMatcher.test.ts`

- [ ] Write failing Vitest cases for malformed/oversized/native-error messages, finite status mapping, bounded requests, overlap ranking, all-day/cancelled exclusion, ambiguity, and weak candidates.
- [ ] Run `pnpm vitest run tests/unit/calendarProtocol.test.ts tests/unit/calendarMatcher.test.ts` and verify expected failures.
- [ ] Implement strict parsing and the smallest pure matcher that satisfies the cases.
- [ ] Re-run the focused tests and verify they pass.

### Task 3: Local calendar persistence

**Files:**
- Modify: `electron/db.ts`
- Create: `electron/calendar/store.ts`
- Create: `tests/unit/calendarStore.test.ts`

- [ ] Write failing isolated-database tests for singleton state, transactional window replacement, occurrence idempotency, stale revision rejection, meeting association, user override, and disconnect purge.
- [ ] Add `calendar_integration`, `calendar_events`, and `meeting_calendar_context` tables plus indexes and foreign keys.
- [ ] Implement focused store functions for state, replacement, day queries, links, and purge.
- [ ] Run `pnpm vitest run tests/unit/calendarStore.test.ts` until green.

### Task 4: Helper supervision, refresh, and IPC

**Files:**
- Create: `electron/calendar/client.ts`
- Create: `electron/calendar/service.ts`
- Modify: `electron/main.ts`
- Create: `tests/unit/calendarService.test.ts`

- [ ] Write failing service tests for runtime resolution, explicit permission request, one-calendar selection, serialized refresh, stale-run invalidation, EventKit change debounce, preserved snapshot on failure, missing calendar, and disconnect.
- [ ] Implement helper supervision using Pluto's JSON-line process conventions and known development/packaged paths only.
- [ ] Register `CALENDAR_GET_STATE`, `CALENDAR_CONNECT`, `CALENDAR_SELECT`, `CALENDAR_REFRESH`, `CALENDAR_LIST_DAY`, `CALENDAR_DISCONNECT`, and Calendar System Settings handlers.
- [ ] Start enabled refresh on app ready, stop it on quit, and associate saved meetings from the persisted cache without blocking EventKit.
- [ ] Run the focused service and existing native-process tests until green.

### Task 5: Typed renderer API and Dashboard agenda

**Files:**
- Create: `src/api/calendar.ts`
- Create: `src/components/features/UpcomingMeetings.tsx`
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `src/App.tsx`
- Create: `tests/unit/calendarApi.test.ts`
- Create: `tests/unit/UpcomingMeetings.dom.test.tsx`
- Modify: `tests/unit/Dashboard.dom.test.tsx`

- [ ] Write failing API and DOM tests for two-row truncation, inline See more disclosure, next-event marker, loading, first-run, denied, clear-day, and degraded states.
- [ ] Implement the typed IPC wrapper and a compact divider-based agenda with keyboard-visible controls and tabular times.
- [ ] Place Upcoming meetings first in the right rail, move Recent win beneath it, and remove Continue where you left off.
- [ ] Load and refresh the agenda in App without coupling it to dashboard synthesis.
- [ ] Run the focused DOM/API tests until green.

### Task 6: Settings selection, recovery, and disconnect

**Files:**
- Create: `src/components/features/CalendarSettings.tsx`
- Modify: `src/components/features/SettingsTab.tsx`
- Create: `tests/unit/CalendarSettings.dom.test.tsx`

- [ ] Write failing DOM tests for connect copy, truthful macOS full-access disclosure, calendar selection, ready metadata, refresh, change, denial recovery, no calendars, degraded state, and disconnect.
- [ ] Implement the focused Settings section using the typed API and existing control vocabulary.
- [ ] Verify denial and failures never disable recording controls.
- [ ] Run the focused Settings tests until green.

### Task 7: Meeting context provenance

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/AudioManager.tsx`
- Create: `tests/unit/meetingCalendarContext.test.ts`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

- [ ] Write failing tests that calendar title/participants are labeled `macos_calendar`, never overwrite a user title, never enter transcript evidence/model inputs, and behave identically for normal/fallback/recovery saves.
- [ ] Surface the persisted association as a compact context block and optional title suggestion; keep unmatched/ambiguous cases user-controlled.
- [ ] Run the focused provenance and save-path tests until green.

### Task 8: Packaging, durable records, and verification

**Files:**
- Modify: `electron-builder.json5`
- Modify: `scripts/verify_packaged_runtime.mjs`
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-30-native-calendar-context.md`
- Modify: `tests/unit/packagedRuntimeResources.test.ts`

- [ ] Write a failing packaging test for the helper executable and Calendar purpose string.
- [ ] Add the helper resources and signing metadata to packaging verification.
- [ ] Record the Dashboard-first EventKit decision and add the #617 changelog fragment.
- [ ] Run Swift tests, focused Vitest, `pnpm exec biome lint` on changed TypeScript/TSX, `pnpm run changelog:check`, `pnpm run build:calendar-helper`, `pnpm run build`, `pnpm run package:verify-runtime`, full `pnpm vitest run`, and `git diff --check`.
- [ ] Launch the renderer/Electron harness, inspect desktop-wide and narrow-window states, perform at least one critique/fix pass, and explicitly separate rendered UI evidence from real macOS TCC permission evidence.
