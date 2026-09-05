# Proactive Calendar Session Auto-Naming, Start Prompts, and Silence-Based Auto-Stop Design Spec

- **Issue**: [Issue #747](https://github.com/metagrover/pluto/issues/747)
- **Status**: Approved
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
5. Use calendar context to help the user identify anonymous remote speakers without treating an invitation as attendance or identity proof.

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
  - Makes attendee names available as transcription-vocabulary hints and meeting-local identity choices without routing them through the manual-participant persistence path.
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

### 2.5 Meeting-Local Speaker Review and People Handoff

Accepted System-audio diarization clusters retain canonical `Remote Speaker N` labels in persisted transcript evidence. The meeting UI projects those labels as the shorter `Speaker N` until the user confirms a person. Generic labels including `Remote Speaker N`, `Speaker N`, `Local Speaker N`, and equivalent placeholder forms are never valid People entities.

When a finalized transcript contains anonymous remote clusters, the transcript header shows `N unidentified speakers · Review`. Opening the review presents one compact row per speaker with:

- the projected `Speaker N` label;
- representative transcript excerpts from that cluster;
- an on-demand 5–8 second sample selected from a clean, non-overlapping turn in the saved isolated System recording;
- a second representative sample when another eligible turn exists;
- unambiguous calendar-attendee choices labeled as invited, existing People choices, and a create-person action.

Only one sample plays at a time. The main process resolves the saved System artifact from the meeting ID, validates the requested canonical speaker against the persisted transcript, selects a bounded source interval, produces a temporary WAV, reads its bounded bytes, and deletes the file before replying. The renderer receives audio bytes rather than a filesystem path, creates a short-lived object URL, and revokes it after playback, when the meeting changes, and on window cleanup. If the System artifact is unavailable or the cluster has no eligible interval, the sample control is omitted and text-based review remains available.

Selecting a person opens a concise confirmation: `Use Alex Chen for Speaker 1 in this meeting?` The confirmation states how many transcript turns will change in the display and that the meeting will become confirmed conversation evidence for that person. Confirming writes the existing reversible, meeting-scoped identity binding; it does not rewrite transcript labels. The projected name updates immediately across the transcript, the People summary and dossier read the binding as direct evidence, affected identity-dependent suggestions are rechecked, and an Undo action clears the binding.

Clearing or undoing a binding removes only the binding-derived confirmed evidence. Any independent calendar relationship remains scheduled/invited, and any independent transcript mention remains mention-only. Existing evidence must not be deleted merely because the speaker correction was cleared.

Calendar context remains roster evidence. It can supply vocabulary hints and direct identity choices, but it does not auto-create confirmed People, increment confirmed conversation counts, or establish ownership. Duplicate attendee names and ambiguous same-name People are not offered as direct choices.

Cross-meeting voice recognition, persistent speaker embeddings, automatic naming, and voice profiles are outside this PR and tracked in [Issue #755](https://github.com/metagrover/pluto/issues/755).

### 2.6 Speaker Review Data Flow

1. Final transcription persists canonical anonymous labels and word/segment timing.
2. Meeting presentation maps canonical anonymous labels to `Speaker N` without modifying saved evidence.
3. The review UI requests a sample using only `meetingId`, canonical speaker label, and a bounded sample index.
4. Electron loads the saved meeting, verifies its System artifact and transcript, chooses a supported interval, and produces a temporary clip.
5. Explicit confirmation creates or reuses a person and writes the meeting-scoped identity binding transactionally.
6. People read models union binding-derived confirmed meetings with scheduled and mentioned evidence, using `confirmed > scheduled > mentioned` precedence for the same meeting.
7. The identity revision queues only the existing bounded recheck work; playback never triggers inference or persistence.

### 2.7 Failure and Concurrency Behavior

- Missing or unreadable audio disables only voice-sample playback; identity selection and transcript viewing remain usable.
- A stale identity revision reloads the latest choices and requires the user to confirm again.
- A meeting change or component unmount cancels playback and invalidates late sample responses.
- Sample-generation failures expose a quiet retry action without logging paths, transcript text, attendee names, or audio content.
- A failed downstream identity recheck retains the confirmed binding and reports that suggestions could not yet be refreshed.
- Undo is revision-safe and cannot erase a newer correction made elsewhere.

### 2.8 Verification

- Pure tests cover anonymous display projection, placeholder-person rejection, representative sample selection, overlap/short-turn exclusion, bounded durations, and evidence precedence.
- IPC tests cover meeting-derived path resolution, speaker validation, missing/deleted artifacts, sample index bounds, temporary cleanup, and rejection of arbitrary paths.
- Database tests prove that invited attendees remain scheduled, confirmed bindings appear consistently in People summary/detail and person-context inputs, and clearing a binding preserves independent evidence.
- DOM tests cover the unidentified-speaker count, sample playback exclusivity, calendar-choice labels, confirmation copy, immediate transcript projection, stale revisions, and Undo.
- Existing calendar matching, recording finalization, diarization, identity, People, transcript-integrity, and packaged-runtime checks remain required.

---

## 3. Security, Privacy & Constraints
- Calendar integration remains strictly read-only through local EventKit (`PlutoCalendarHelper`).
- Never auto-start recording without user interaction (prompts require 1-click user confirmation).
- Keep calendar context strictly local to SQLite; no private calendar details leave the user's Mac.
- Voice samples are derived locally from existing meeting audio, never uploaded, never retained as identity profiles, and never reused across meetings.
- Persisted anonymous acoustic labels remain authoritative evidence; friendly labels and confirmed names are reversible projections.
- Calendar invitation, display-name equality, transcript name mentions, and model confidence are not identity proof.
