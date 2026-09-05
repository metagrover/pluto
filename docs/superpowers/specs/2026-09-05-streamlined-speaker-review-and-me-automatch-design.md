# Streamlined Speaker Identity Review and "Me" Automatch Design

**Date:** 2026-09-05  
**Issue:** [#758](https://github.com/metagrover/pluto/issues/758)  
**Register:** Product (Notion + Linear merger aesthetic)

---

## 1. Problem Statement & User Needs

Pluto captures local microphone speech as `Me` and separated remote voices as `Speaker 1`, `Speaker 2` (canonical `Remote Speaker N`). 

Currently, the interface suffers from three major issues:
1. **Awkward Spacing & Visual Clutter:** The top of the transcript stacks multiple borders and legalistic system disclaimers (*"Transcript ready · Remote speaker labels applied"*, *"Capture-time identity does not by itself identify every speaker"*), creating a striped, cluttered appearance with awkward vertical rhythm.
2. **Form-Heavy, High-Friction Speaker Collection:** The speaker review UI uses native OS `<select>` dropdowns, uppercase tracked labels, plain text buttons, and a multi-step staging/confirmation box with side-stripe borders (`border-l-2`, an Impeccable ban). Assigning speakers feels like editing a database table instead of using a polished intelligence tool.
3. **"Me" Profile Automatch Failure:** Even when a user configures their preferred name and nickname(s) in **Settings → About you**, `Me` often remains untagged in the transcript because of over-restrictive acoustic diarization confidence gates (requiring confidence >= 0.85 and non-null capture-time IDs). The user is forced to manually confirm that "Me" is an individual, and the transcript displays raw `Me` instead of their name.

---

## 2. Goals & Anti-Goals

### Goals
- **Notion + Linear Craft:** Clean typography, compact information hierarchy, subtle hover states, minimal border lines, and zero unnecessary system chatter.
- **Fast, 1-Click Assignment:** High-confidence calendar attendees and recent people appear as quick-pick suggestion chips. Clicking assigns immediately with an undo affordance.
- **In-Context Interaction:** Allow clicking `Speaker 1` directly on any transcript turn to assign or rename them without having to scroll to the top.
- **Delightful Mini-Player:** Replace the text link with a compact, modern audio snippet button `[ ▶ 0:04 ]` with playing state and progress indicator.
- **Frictionless "Me" Attribution:** If the user has configured their profile in Settings, any local recording with `Me` turns automatically binds to their profile and displays as **Preferred Name (You)**.
- **Roster Intelligence:** Exclude the user's name and configured nicknames/aliases from the external speaker suggestions list.

### Anti-Goals
- We are not changing the underlying acoustic diarization model or raw audio storage format.
- We are not automatically guessing remote speakers without human confirmation (per Pluto trust principles, remote speaker assignment requires user action).

---

## 3. UI/UX Specification (Notion / Linear Merger)

### A. Transcript Header & Spacing Clean-up
- Remove the standalone `remoteSpeakerStatus` bordered banner from the main transcript flow.
- Remove redundant system disclaimer copy (*"Corrections apply only to this meeting..."*, *"Local recording. Capture-time identity..."*). If needed, a subtle `(i)` tooltip on the section header provides this detail without polluting the default layout.
- Use a single, clean border below the transcript toolbar:
  - Left: `Transcript` (h2) · turn count or duration
  - Right: Quick search / filter / hide controls

### B. Compact Speaker Triage Bar
When unassigned remote speakers exist (`unidentifiedCount > 0`):
- Renders as a lightweight, cohesive tray above the transcript turns (no nested cards, no loud borders).
- **Header:**
  - `2 unidentified speakers` with a subtle amber status dot and turn count.
  - Option to collapse/dismiss.
- **Speaker Row (Linear-style compact row):**
  - **Speaker Pill:** `Speaker 1` (with subtle badge `1 turn`).
  - **Mini Voice Sample Player:** A polished micro-player:
    - Default: `[ ▶ 0:04 ]` (dark/pro button with play triangle and duration).
    - Playing: `[ ❚❚ 0:02 ]` (pause icon with active accent color).
    - Error fallback: subtle inline retry icon.
  - **Quote Snippet:** Truncated inline excerpt in quotes: *“Blue notebook is on the desk, I will review…”*
  - **Quick Suggestions:**
    - Chips for invited calendar attendees: `[ + Alex Chen ]` `[ + Taylor Swift ]`.
    - Clicking a chip immediately assigns the speaker across all turns.
  - **Custom Combobox / Action:**
    - `[ Assign ▾ ]` opens a Notion-style popover menu with:
      - Search input (`Search or create person…`)
      - List of workspace people with avatar/initials
      - `+ Create "[typed name]"` option
- **Instant Feedback & Reversibility:**
  - Once assigned, the row displays: `Speaker 1 is Alex Chen` with an inline `Undo` button.
  - No separate confirmation dialog or staging box required.

### C. In-Transcript Turn Tagging
- On any transcript turn where the speaker is `Speaker N`:
  - The speaker label is an interactive button: `Speaker 1 ▾`.
  - Clicking opens the same quick-assign popover right at the turn.
  - Clicking on a turn's speaker assigns that speaker globally for the meeting.

---

## 4. Backend & Automatch Specification

### A. Automatic "Me" Binding
In `electron/commitmentIdentity.ts`:
- Check if the workspace has a configured user: `const workspaceSelfPersonId = db.identityStore.getSelfPersonId();`
- If `turns` contain `speaker === 'Me'` and `capture.origin === 'local'` (or if `workspaceSelfPersonId` is set and no conflicting binding exists for `Me`):
  - Bind `Me` directly to `workspaceSelfPersonId`.
  - Mark binding as `source: 'capture'` with `individual: true`.
  - Remove the requirement that `attribution.confidence >= 0.85` or that `capture.selfPersonId` must have been non-null at recording start. (The user recording locally with their mic is inherently the workspace user).

### B. User Profile & Alias Roster Filter
In `src/components/features/MeetingIdentityControls.tsx`:
- Retrieve `selfPersonId` and `profile` from `state`.
- Normalize all user aliases (`profile.preferredName`, `profile.aliases`).
- Filter out any attendee from `attendeeChoices` whose normalized name matches the user's name or any of their aliases.

### C. Transcript Presentation
In `src/components/features/meetingTranscriptPresentation.ts`:
- If `binding.speaker === 'Me'`, format the display name as `${personName} (You)`.
- If no binding exists for `Me` but `selfProfile.preferredName` exists, project `${selfProfile.preferredName} (You)` directly.

---

## 5. Verification Plan

### Automated Tests
1. **Unit tests for `commitmentIdentity`:**
   - Verify `Me` is bound to `workspaceSelfPersonId` even if `storedCapture.selfPersonId` was null at recording time.
   - Verify `Me` binds without requiring `attribution.confidence >= 0.85`.
2. **Unit tests for `meetingTranscriptPresentation`:**
   - Verify `applyMeetingSpeakerDisplayNames` projects `${name} (You)` for `Me`.
3. **DOM tests for `MeetingIdentityControls`:**
   - Verify compact triage layout renders without native select elements or `border-l-2` classes.
   - Verify calendar attendees matching the user or their nicknames are excluded from remote speaker suggestions.
   - Verify 1-click chip assignment and Undo functionality.
4. **Full Test Suite & Lints:**
   - `pnpm exec vitest run tests/unit/IdentityControls.dom.test.tsx tests/unit/commitmentIdentity.test.ts tests/unit/meetingTranscriptPresentation.test.ts`
   - `pnpm exec tsc --noEmit`
   - `pnpm run lint`

### Manual Verification
- Open Meeting view in the app with local recording containing `Me` and `Remote Speaker 1`.
- Confirm `Me` shows the user's preferred name with `(You)`.
- Confirm the transcript header spacing is clean, balanced, and free of redundant borders and system disclaimers.
- Test playing audio samples with the new mini-player.
- Test 1-click assigning a speaker from suggestion chips and undoing.
