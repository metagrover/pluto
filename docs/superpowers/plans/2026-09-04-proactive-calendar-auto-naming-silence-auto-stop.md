# Implementation Plan: Proactive Calendar Auto-Naming, Start Prompts, and Silence-Based Auto-Stop

- **Issue**: [Issue #747](https://github.com/metagrover/pluto/issues/747)
- **Status**: Ready for execution
- **Date**: 2026-09-04

---

## Phase 1: Proactive Calendar Matcher & Auto-Naming (TDD)
1. **Tests First**:
   - Create `tests/unit/calendarMatcherActive.test.ts`:
     - Test candidate event ranking within $\pm 15$ minutes of current time.
     - Test ongoing event scoring vs upcoming vs recently ended.
     - Test ambiguity resolution (ties < 0.08 difference).
     - Test exclusion of all-day and cancelled events.
     - Test clean fallback when no events are within window.
2. **Implementation**:
   - In `electron/calendar/matcher.ts`:
     - Implement `matchActiveCalendarEvent(atTime: string, events: CalendarEvent[]): CalendarMatch`.
   - In `electron/calendar/store.ts`:
     - Implement `matchActiveEvent(atTime: string)`.
     - Implement `associateMeetingAtStart(meetingId: string, atTime: string)`.
   - In `electron/main.ts`:
     - Add IPC handler `CALENDAR_MATCH_ACTIVE`.
   - In `src/api/calendar.ts`:
     - Expose `matchActiveCalendarEvent(atTime: string)`.
   - In `src/App.tsx` & `src/components/AudioManager.tsx`:
     - Check `calendar_auto_name_enabled` when starting recording.
     - If matched, initialize `meetingTitle` and `meetingParticipants` immediately.
     - Associate meeting context in store.

---

## Phase 2: Conference URL Detection & Meeting Start Prompts
1. **Tests First**:
   - Create `tests/unit/conferenceUrl.test.ts`:
     - Test URL extraction and detection for Zoom (`zoom.us/j/...`, `zoom.us/my/...`, `*.zoom.us/wc/...`).
     - Test Google Meet (`meet.google.com/xxx-yyyy-zzz`).
     - Test Microsoft Teams (`teams.microsoft.com/l/meetup-join/...`, `teams.live.com/meet/...`).
     - Test Webex & Slack huddle links.
     - Test handling of events with/without conference URLs.
   - Create `tests/unit/calendarMeetingPrompt.test.ts`:
     - Test prompt eligibility window (upcoming within 15 min or ongoing).
     - Test dismissal per `occurrenceKey`.
     - Test 1-click start callback.
2. **Implementation**:
   - In `src/utils/conferenceUrl.ts`:
     - Implement `extractConferenceUrl` and `hasConferenceLink`.
   - In `src/components/alerts/CalendarStartPromptBanner.tsx`:
     - Build sleek, non-intrusive floating pill banner with 1-click Start Recording and Dismiss.
   - In `src/hooks/useCalendarPromptMonitor.ts`:
     - Implement agenda polling and eligibility checking when idle.
   - In `src/App.tsx`:
     - Mount banner when eligible prompt is active and `calendar_prompt_enabled` is true.

---

## Phase 3: Silence Watchdog & Clean Auto-Stop (TDD)
1. **Tests First**:
   - Create `tests/unit/silenceWatchdog.test.ts`:
     - Test watchdog initialization with configured silence duration (3m, 5m, 10m, disabled).
     - Test speech activity resets watchdog.
     - Test auto-stop triggers when continuous silence exceeds duration AND calendar event end time passed.
     - Test auto-stop triggers when conference audio drops to silent.
     - Test manual stop overrides watchdog.
     - Test watchdog disabled state.
   - Create `tests/unit/autoStopJournalSeal.test.ts`:
     - Test auto-stop triggers clean journal sealing and preserves `end_reason = 'auto:silence_timeout'`.
2. **Implementation**:
   - In `src/autoStop/silenceWatchdog.ts`:
     - Implement `createSilenceWatchdog`.
   - In `src/components/AudioManager.tsx`:
     - Wire `silenceWatchdog` to VAD energy, speech events, and calendar event end time.
     - On timeout, invoke `stopSession('auto:silence_timeout')` or `stopSession('auto:calendar_silence_timeout')`.
   - In `electron/main.ts`:
     - On downstream notes publication (`MEETING_NOTES_UPDATED`), dispatch system notification when notes are ready.

---

## Phase 4: User Settings & Configuration
1. **Implementation**:
   - In `src/components/features/SettingsTab.tsx`:
     - Under Meetings → Recording section:
       - Add toggle for *Auto-name meetings from calendar* (`calendar_auto_name_enabled`, default true).
       - Add toggle for *Prompt to record upcoming meetings* (`calendar_prompt_enabled`, default true).
       - Add selector for *Auto-stop recording on prolonged silence* (`silence_auto_stop_duration`: 3 min, 5 min [default], 10 min, Disabled).
   - In `src/App.tsx`:
     - Load settings via `GET_SETTING`, manage state, and persist changes via `SET_SETTING`.
     - Pass settings to `AudioManager` and prompt monitor.

---

## Phase 5: Verification, Durable Memory & PR
1. **Run automated test suite**:
   - Run vitest on all new and existing test files.
   - Verify 0 regressions.
2. **Lint & Code Quality**:
   - `pnpm run check` / `pnpm run lint`.
3. **Durable Documentation**:
   - Update `docs/decisions.md`.
   - Create changelog entry in `docs/changelog/entries/2026-09-04-747-proactive-calendar-auto-stop.md`.
   - Validate with `pnpm run changelog:check`.
4. **Git Commit & Pull Request**:
   - Commit changes cleanly.
   - Push to `feat/747-proactive-calendar`.
   - Create PR linking Issue #747.
