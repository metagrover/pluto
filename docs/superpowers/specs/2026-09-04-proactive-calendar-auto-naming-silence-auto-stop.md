# Proactive Calendar Session Auto-Naming, Start Prompts, and Silence-Based Auto-Stop Design Spec

- **Issue**: [Issue #747](https://github.com/metagrover/pluto/issues/747)
- **Status**: Proposed
- **Date**: 2026-09-04

---

## 1. Overview & Problem Statement

Meeting recording in Pluto currently requires manual start, manual naming, and manual stop. Calendar matching in `electron/calendar/matcher.ts` operates strictly retroactively after recording has already concluded.

This leads to two common frictions:
1. **Generic / Untitled Meetings**: Recordings start with default timestamps or untitled placeholders, losing early context like meeting topic and expected participants.
2. **Runaway Recordings on Silence**: When users leave a call or walk away from their desk without clicking stop, Pluto captures room silence for hours. This wastes disk storage, drains battery/thermal budget, and degrades post-meeting notes by feeding hours of trailing silence into downstream transcription.

Pluto proactively leverages system calendar integration to:
1. Automatically title and contextualize active meetings at recording start time.
2. Surface non-intrusive start prompts when scheduled calendar meetings begin.
3. Automatically stop capture after prolonged silence once a meeting concludes, gracefully sealing the append-only capture journal and transitioning to finalization.
4. Provide granular user controls in Settings.

---

## 2. Architecture & Components

```
                     ┌─────────────────────────────┐
                     │   CalendarService / Store   │
                     │     (Local EventKit DB)     │
                     └──────────────┬──────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │     Proactive Matcher & Conference URL Detector        │
       │   - matchActiveCalendarEvent(now, events) (±15m)       │
       │   - extractConferenceUrl(event) (Zoom, Meet, Teams)    │
       └──────────────┬──────────────────────────┬──────────────┘
                      │                          │
                      ▼                          ▼
       ┌────────────────────────┐      ┌────────────────────────┐
       │ Calendar Start Prompt  │      │ Proactive Auto-Naming  │
       │  (Banner / Pill UI)    │      │  (Title & Attendees)   │
       └────────────────────────┘      └──────────┬─────────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────────┐
                                       │    Recording Session   │
                                       │   (AudioManager.tsx)   │
                                       └──────────┬─────────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────────┐
                                       │    Silence Watchdog    │
                                       │ (VAD / RMS & Cal End)  │
                                       └──────────┬─────────────┘
                                                  │ prolonged silence
                                                  ▼
                                       ┌────────────────────────┐
                                       │ Clean Auto-Stop Seal   │
                                       │ (Journal Seal -> Notes)│
                                       └────────────────────────┘
```

### 2.1 Proactive Calendar Matching (`electron/calendar/matcher.ts`)
- Candidate window: scheduled non-all-day, non-cancelled events whose schedule overlaps or falls within $\pm 15$ minutes of current time `now`:
  - `start - 15m <= now <= end + 15m`.
- Candidate scoring:
  - If `start <= now && now <= end`: ongoing event. Score: `0.9 + 0.1 * (1 - |now - start| / duration)`.
  - If `now < start`: upcoming event within 15 minutes. Score: `0.85 * (1 - (start - now) / 15m)`.
  - If `now > end`: recently ended event within 15 minutes. Score: `0.65 * (1 - (now - end) / 15m)`.
- Qualification & Ambiguity:
  - Minimum qualification threshold: score >= 0.5.
  - Winner margin: difference between top candidate and runner-up must be >= 0.08. If less, candidate match is marked `ambiguous`.
- Auto-naming outcome:
  - When `calendar_auto_name_enabled` is true:
  - Sets `meetingTitle` to `event.title`.
  - Sets `meetingParticipants` to `event.attendees.map(a => a.name || a.email).filter(Boolean)`.
  - Associates `meeting_calendar_context` in SQLite with `origin = 'automatic'` and `match_evidence = 'time_overlap'`.

### 2.2 Meeting Start Prompts (`src/components/alerts/CalendarStartPromptBanner.tsx`)
- Detects upcoming or active events (starts within `[-5m, +15m]`) that feature conference links (Zoom, Google Meet, Microsoft Teams, Webex, Slack).
- Displays a floating pill / banner at the top of the main window when `!isRecording`:
  - Shows event title and relative time (`"Sprint Planning" • starts in 2m`).
  - 1-click **Record** button immediately starts recording with title & participants pre-populated.
  - Dismiss button (X) suppresses prompts for this specific `occurrenceKey`.
- Controlled by user setting: `calendar_prompt_enabled` (default: `true`).

### 2.3 Silence-Based Auto-Stop Watchdog (`src/autoStop/silenceWatchdog.ts`)
- Monitors audio energy from VAD / RMS calculations:
  - `micRms` from mic analyser.
  - `systemRms` from system audio tap.
  - `nextSpeaker` from speaker classifier.
  - Incremental transcription segment events.
- Resets silence watchdog whenever speech is detected (`rms >= threshold` or speaker active or segment emitted).
- When continuous silence exceeds user-configured duration (3m, 5m, 10m):
  - Check whether the scheduled calendar event end time has elapsed (`now >= calendarEndTimeMs`), OR conference output has dropped to silence (`systemRms === 0` / call app exited).
  - If condition met: invokes clean stop with reason `auto:silence_timeout` or `auto:calendar_silence_timeout`.
- Auto-stop execution:
  - Invokes `stopSession(endReason)`.
  - Executes full append-only journal seal via `sealCaptureJournalBeforeFinalization`.
  - Persists meeting with `end_reason` and transitions to finalization.
  - Dispatches system notification when meeting notes are published.
- Manual stop remains immediate and always overrides the watchdog.

### 2.4 User Settings & Controls (`src/components/features/SettingsTab.tsx`)
Under Settings → Meetings → Recording:
1. **Auto-name meetings from calendar**: Toggle (Default: On, key: `calendar_auto_name_enabled`).
2. **Prompt to record upcoming meetings**: Toggle (Default: On, key: `calendar_prompt_enabled`).
3. **Auto-stop recording on prolonged silence**: Select (Options: 3 minutes, 5 minutes [Default], 10 minutes, Disabled; key: `silence_auto_stop_duration`).

---

## 3. Security, Privacy & Constraints
- Calendar integration remains strictly read-only through local EventKit (`PlutoCalendarHelper`).
- Never auto-start recording without user interaction (prompts require 1-click user confirmation).
- Keep calendar context strictly local to SQLite; no private calendar details leave the user's Mac.
