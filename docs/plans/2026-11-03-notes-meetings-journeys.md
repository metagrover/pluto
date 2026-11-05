# Notes, meetings, tasks and Ask Pluto: journey review and proposal

Date: 2026-11-03 · Branch: `notes-workspace-editor`

## Status (2026-11-04)

Built and checked in the app (tests plus a scripted run of the built app on a
throwaway profile with sample data):

- Phase 1: note tasks stay in their own note; prep note items are checkboxes
  that tick the note; mentions no longer link silently; the Notes side card
  states only what prep does; finished meetings show "Before the meeting";
  attendee notes are found by email through prep's links.
- Meeting page as one document: your notes continue the document at its end;
  clicking below the summary writes there; cleared lines no longer spring back;
  deleted lines disappear; "Add item" appears only while editing a section.
- Phase 3 (core): "Next time with …" on a person's page, Start 1:1 without a
  calendar, and the recording's Prep tab listing those items.
- Phase 2 (core): a note's "Meeting" menu: Start meeting now, or add the note
  to an upcoming meeting's prep.
- Phase 4 (part): Ask Pluto on finished meetings, ⌘J to focus it.

- "Who was this with?" on unplanned meetings, with "With …" in the header;
  people you add count as confirmed meetings on their page.
- One "Meetings and notes" timeline on a person's page.
- Ask Pluto in a person's note also reads their three latest meetings, named.

Decided against: every checkbox as a task. Checklists are what "Next time
with …" and prep are built on; tasks stay `[task: …]` lines, labeled in the
editor.

Second round (2026-11-04):

- A note used for an upcoming meeting is linked to its prep, not copied; prep
  shows it as it reads now, and the note's menu says "For …".
- "Use your 'X' note for this meeting?" while recording, for a note edited in
  the last day that is titled like the meeting or names someone in it.
- Ask Pluto answers (finished meetings, person chat) offer "Add as to-do" and
  "Add to Next time with …", each edited before adding.
- Ask Pluto and search read notes added after a meeting.
- "Came up in …" on Next-time items found in the latest meeting's transcript,
  by word matching; hideable, and the item stays until ticked.

Known limits: "Came up in" opens the meeting, not the moment; owner prefixes
("Priya: send deck") are not parsed; live notes during recording are still a
plain text box; Start 1:1 and "Use your note?" have not been tried with a real
recording.

## How this was checked

Every statement about current behavior comes from reading the code on this
branch; file references are given inline. The app was not clicked through, so
visual details (spacing, wording on screen, timing) are not verified. Where the
code allows more than one outcome, both are named.

---

## 1. What exists today

### Places a user can write about a meeting

| Place | Where it lives | When it exists |
|---|---|---|
| Prep notes | `meeting_prep.notes`, one per calendar occurrence (`electron/meetingPrep.ts:24-35`) | Only for calendar events. The prep sheet says "Choose a calendar meeting to prepare its notes and references" without one (`PreMeetingBriefSheet.tsx:206-210`) |
| Live notes | Plain textarea in the recording rail (`RecordingMeetingRail.tsx:334-337`), saved to `meetings.user_notes` | During recording. Seeded from prep notes when started from a calendar event (`App.tsx:1338-1342`) |
| "Your notes" on the finished meeting | Same `user_notes`, shown as the last section under the generated summary (`meetingNotesDocument.ts:631-645`) | After recording |
| Notes workspace notes | `notes` table; types scratchpad / person / project / general, one `target_id` (`schema.ts:1542-1558`) | Any time |
| "Running 1:1 Notes" on a person page | A Notes note titled "1:1 with X", `noteType: 'person'` (`PeopleTab.tsx:743-760`, `2310`) | Any time; a separate section from that person's Meetings list (`PeopleTab.tsx:2386`) |

### What already carries forward (calendar only)

The pre-meeting brief already finds the previous meeting in the same calendar
series, or a related one by attendee overlap (`preMeetingBrief.ts:147-163`,
`480-500`). It fills **Last time**, **Still open** (open and overdue
commitments from those meetings, `preMeetingBrief.ts:596-628`) and **Talking
points** (`preMeetingBrief.ts:651`). Without a calendar event none of this is
reachable, because the brief is built from a `CalendarEvent`.

### Tasks

- Meeting action items become tasks (`meetingActionSync.ts`).
- In notes, only `[task: …]` lines (or `- [ ] [task] …`) become tasks. Plain
  checkboxes stay inside the note (`NotesView.tsx:678-683`).
- A note task is matched to an existing task **by title text**
  (`NotesView.tsx:693-695`), and completion syncs back into notes by title
  (`noteActionSync.ts:44-100`). Two tasks with the same wording can be merged.
- Note tasks have no owner field; they get a project only when the note's single
  target is a project (`NotesView.tsx:700-703`).

### Ask Pluto: four entry points, four scopes

| Entry | Scope | File |
|---|---|---|
| Chat with Pluto (sidebar, ⌘K) | Everything | `AskPluto.tsx` |
| Live dock during recording | That live meeting: title, participants, notes, transcript | `ZenMode.tsx`, `MeetingAskPlutoDock.tsx` |
| Person chat (person page) | That person, with saved threads | `PersonChatDock.tsx` |
| Note panel (⌘J) | Only the open note's text, plus the linked name | `noteAskPluto.ts:146-175` |

A finished meeting page has no Ask entry point of its own.

---

## 2. Journeys as they work today

### J1. Recurring 1-1, calendar connected

1. Dashboard → Upcoming → **Prepare** opens the prep sheet (`UpcomingMeetings.tsx:469-482`).
2. The sheet shows invitees, the calendar agenda, a prep textarea, an
   "Included meetings" picker and the brief with Last time / Still open
   (`MeetingPrepEditor.tsx`, `MeetingPrepBrief.tsx`).
3. Unchecked checkboxes from notes **targeted** to an attendee are offered for
   import. Importing copies their text into prep (`MeetingPrepEditor.tsx:69-112`).
4. **Start meeting** is allowed from 5 minutes before the start
   (`meetingPrep.ts:77-89`). Prep notes seed the live notes.
5. During recording, the rail has Meeting / Prep tabs (`RecordingMeetingRail.tsx:58`, `340-351`).
6. Afterwards the generated summary leads and the typed notes sit under it as
   "Your notes". The finished page does not show the prep or brief it came from
   (no prep reference in `MeetingView.tsx`; prep is only used to set calendar
   context and title, `electron/main.ts:4684`, `11216`).

**Friction**
- The brief already does the carry-forward, but it lives only in the prep sheet,
  and the finished meeting doesn't link back to it.
- Imported checklist items are copies. Ticking one in the meeting doesn't tick
  it in the person note, so it comes back next time.
- The "Running 1:1 Notes" doc on the person page and the series of meetings are
  two unconnected things. A user who keeps a running doc (the most common 1-1
  habit) gets no link between it and the meetings.

### J2. Recurring 1-1, no calendar

1. No upcoming list, no prep sheet, no brief.
2. The user records from the sidebar (`Sidebar.tsx`, ⌘N). The title and participants are
   empty; participants typed in the rail are only transcription hints
   (`AudioManager.tsx:2378-2383`).
3. Afterwards, attaching people means finding **Identify Speakers** in the
   meeting header (`MeetingView.tsx:1641-1681`).
4. The person page shows the meeting under Meetings, and separately offers
   "+ 1:1 Note".

**Friction**
- Nothing from last time is shown before or during the next 1-1. All of the
  carry-forward logic exists but needs a calendar event to run.
- There's no "Start 1-1 with Priya" entry point; the user has to know to record,
  then to identify speakers.

### J3. A one-off note that turns into a meeting

1. The user writes a note in Notes. Typing the first `@Name` **silently
   converts the note into that person's note** (sets `targetId` and
   `noteType: 'person'`, `NotesView.tsx:1757-1761`, `1891-1895`). Later mentions
   don't link anything.
2. If a linked or mentioned person has a calendar event in the next 7 days
   (substring match on name or email, `NotesView.tsx:2635-2665`), a card
   says "These notes will automatically be available in Meeting Prep for X"
   and offers **+ Insert Agenda Block**, which appends a heading and an empty
   checkbox to the note (`NotesView.tsx:2667-2690`, `~4060-4095`).
3. In reality prep only reads **checkbox lines** from notes **targeted** to that
   person (`notesStore.ts:377-460`). A note that only mentions Priya, or that is
   targeted to a project, is not in her prep. The card's promise can be false.
4. There is no way to record from a note or attach a note to a meeting. Without
   a calendar the note can't reach a meeting at all.

### J4. Unscheduled meeting (hallway, ad-hoc call)

1. Record from the sidebar. If a calendar event overlaps, Pluto suggests
   attaching it (`App.tsx:1560-1610`, `RecordingCalendarSuggestion.tsx`).
2. Otherwise the meeting has no people until the user identifies speakers.

**Friction:** that's reasonable, but there's no prompt to say who it was with,
so the meeting often never joins anyone's history.

### J5. "I want to raise this with them next time"

- With a calendar: write a plain checkbox in a note targeted to the person, then
  import it in prep. Two steps, and it only works for notes targeted to that
  person.
- Without a calendar: no path.

### J6. After the meeting: to-dos and follow-ups

- Action items land in Tasks with a link to the meeting. Commitments appear on
  the person page (Their commitments / Your commitments).
- Checkboxes typed in live notes stay text inside "Your notes"; they are not
  tasks unless written as `[task: …]`.

### J7. Asking a question

- Before (prep): no Ask entry in the prep sheet.
- During: the live dock.
- After (meeting page): none; the user has to go to Chat and phrase the scope.
- On a person: person chat. In a note: the ⌘J panel, but it only sees the
  note's text.

### J8. Recurring group meeting (standup, weekly sync)

- With a calendar: same as J1; the brief uses the series key.
- Without a calendar: nothing groups the meetings. All meetings is grouped by
  date only (`AllMeetingsTab.tsx:45-70`).

---

## 3. Root causes

1. **Carry-forward depends on the calendar.** The logic is good, but it's keyed
   on a `CalendarEvent`, so users without one get no continuity.
2. **The same intent has different surfaces.** Prep textarea, live textarea,
   Notes block editor and the person's running note are four editors with
   different rules (checkboxes behave differently in each).
3. **Links are copies or hidden side effects.** Prep imports copy text; the
   first `@` silently re-types a note; tasks match by title.
4. **The UI promises things the data doesn't do.** The "automatically available
   in Meeting Prep" card.
5. **Ask Pluto's scope changes with the screen, and is missing where people
   most need it** (a finished meeting, and the note panel can't see related
   meetings).

---

## 4. Proposal

### Principles

1. **Copy existing habits.** A running 1-1 doc, a page per meeting, a checkbox
   for a to-do, asking where you're looking.
2. **Start where the user already is:** an upcoming event, a person, or a note.
3. **Same behavior everywhere.** A checkbox, a mention and the Ask shortcut
   mean the same thing on every screen.
4. **No hidden side effects.** Anything Pluto links is visible, and one click undoes it.
5. **The calendar adds timing; it is never required** for continuity.

### 4.1 "Next with [person]": one list that follows the person

Turn the brief's **Still open** into a list that exists per person, whether or
not a calendar is connected. It contains:

- open commitments from meetings with them (what the brief already computes);
- unchecked checkboxes from notes that include them;
- anything the user adds for next time.

It is shown in the same form in four places, and ticking an item in any of
them ticks it everywhere (no copies):

| Where | How it appears |
|---|---|
| Person page | Top section, **Next with Priya**, with an "Add something to raise" line. Replaces the separate "Running 1:1 Notes" header |
| Prep sheet (calendar) | The existing Still open block, now including the person's items |
| Recording rail | The existing Prep tab |
| Finished meeting | A short "From before the meeting" block above the summary |

After a meeting, items the transcript shows were covered get a soft *discussed
Oct 30* mark with a link to the moment. The user can undo it, and the item stays
until it's ticked.

### 4.2 Recurring 1-1 without a calendar

- The person page gets **Start 1-1 with Priya**. It does what
  `handleStartFromPrompt` does for calendar events: starts recording with Priya
  as a participant and her **Next with** list in the Prep tab.
- After an unscheduled recording, the meeting header asks once:
  **"Who was this with?"** with the speaker suggestions Pluto already has.
  This records attendance the user confirmed; it does not assign speakers, so
  it stays inside the rule that attendees are hints, not proof of who spoke.
- The person page shows meetings and notes as **one timeline**, newest first,
  instead of separate "Running 1:1 Notes" and "Meetings" sections. Existing
  "1:1 with X" notes stay as they are and appear in that timeline.

With a calendar nothing changes except that the prep sheet and person page show
the same **Next with** list.

### 4.3 A one-off note that turns into a meeting

Add one control to the note header: **Use for a meeting ▾**

- **Upcoming events** (Notes already loads the next 7 days, `NotesView.tsx:498-510`).
  Choosing one makes this note the meeting's prep: the prep sheet shows it, it
  seeds the live notes, and the note gets a line *Used in Acme call · Nov 6 →*.
  The note's own text is never replaced; the summary takes over the meeting
  page only, as it does today.
- **Record now.** Starts recording with this note as the live notes and its
  people as participants. Works without a calendar.

Replace the "automatically available" card with this same action, so the card
offers something that actually happens.

### 4.4 Mentions and people on a note

- `@Name` adds that person to the note, shown as a chip under the title.
  Several people are allowed. Removing the chip removes the link.
- No silent re-typing of the note, and no title change.
- Notes with a person on them feed that person's **Next with** list.

### 4.5 One kind of checkbox

- A checkbox is a to-do everywhere: Notes, prep, live notes. `[task: …]` keeps
  working but is no longer required.
- `Priya: send deck` suggests Priya as the owner; anything else is yours.
- Sync by the block's id, not by title, so similar wording never merges two tasks.
- Tasks groups to-dos by where they came from (meeting, note, person), so
  personal checklists don't drown work.

### 4.6 Ask Pluto: same shortcut, scope follows the page

- ⌘J opens Ask on every page in the same position, with the scope written at
  the top: *Asking about: Acme call, Nov 6*. One click widens it to everything.

| Page | Scope |
|---|---|
| Note | The note, plus meetings with the people on it |
| Prep sheet | The upcoming meeting, its brief and the people's history |
| Recording | Live meeting (as today) |
| Finished meeting | That meeting (new) |
| Person | That person (as today, person chat) |
| Everywhere else | Everything (Chat with Pluto) |

- Answers get **Add to Next with [person]**, **Add as to-do** and
  **Insert into note** (the note panel already has the last two).

### 4.7 The only questions Pluto asks

1. *"Who was this with?"*: after an unscheduled recording.
2. *"Use your 'X' note for this meeting?"*: when a meeting starts and a note
   edited in the last day includes the same people.

Both can be skipped without losing anything.

---

## 5. Build order

| Phase | Ships | Why first |
|---|---|---|
| 1. Fix broken promises | Replace the false prep card; stop the silent `@` re-typing; sync note tasks by id; prep imports become links, not copies; show "From before the meeting" on finished meetings | Small changes; each fixes a case where the UI says something the data doesn't do |
| 2. Note → meeting | **Use for a meeting** and **Record now** in notes | Closes J3 completely, with or without a calendar |
| 3. Next with [person] | Per-person list, Start 1-1 without a calendar, "Who was this with?", one timeline on the person page | Gives continuity without a calendar (J2, J5, J8 by people) |
| 4. One checkbox, one Ask | Checkbox unification, owner prefix, ⌘J everywhere with a visible scope, Ask on finished meetings | Needs phase 3's per-person list for its actions |

### Data changes this implies

- Notes need several people, not one `target_id` (a `note_people` join; keep
  `target_id` readable for existing notes).
- Prep needs an optional `note_id` so a note can be a meeting's prep without copying.
- Checkbox blocks need stable ids that tasks reference (the block editor already
  gives blocks ids).
- **Next with** can be a query over commitments, note checkboxes and a small
  "raise next time" store; it doesn't need to replace the brief.
- No migration rewrites existing notes, prep or meetings.

---

## 6. Decisions needed

1. **Should every checkbox become a to-do?** Recommended: yes, with Tasks
   grouped by source. The alternative keeps two kinds of checkbox, which is the
   current source of confusion.
2. **Should the person page lead with "Next with" instead of the summary?**
   Recommended: yes for people you meet regularly ("Regular collaborators",
   `PeopleTab.tsx:351`); keep the summary first for everyone else.
3. **Group meetings without a calendar:** group them by the same confirmed
   people automatically, or only suggest it? Recommended: suggest only.

---

## 7. How to know it works

Run with people who haven't used Pluto, once with a calendar connected and once
without, with no hints:

1. Get ready for your 1-1 with Priya.
2. Write down something to raise with her next week.
3. Record an unplanned chat, then find it tomorrow from Priya's page.
4. Use your "Vendor eval" note as the notes for the Acme call.
5. Find out what Priya promised last month.

Pass: every task done without help, and nobody asks where something went.

---

## 8. Corrections to the earlier chat proposals

- Prep is **not** blank for calendar 1-1s; the brief already shows Last time
  and Still open. The gap is everyone without a calendar, and the copy-based
  imports.
- The summary **does** take over the meeting page; typed notes are input and
  stay at the bottom as "Your notes".
- Person pages already have a running 1-1 note; the fix is connecting it to
  the meetings, not inventing a new doc type.
