# Guided Speaker Identification Modal and Meeting Header Entry Point Design

**Date:** 2026-09-05  
**Issue:** [#759](https://github.com/metagrover/pluto/issues/759)  
**Register:** Product (Notion + Linear merger aesthetic)

---

## 1. Problem Statement & Motivation

Pluto captures multi-speaker conversations and diarizes remote voices into anonymous clusters (`Speaker 1`, `Speaker 2`). 

Previously, speaker identification was exposed as an inline collapsible accordion directly above the transcript. When expanded, this accordion dumped multiple paragraphs of technical system disclaimers and stacked every unidentified speaker vertically with multiple form controls, audio sample players, and text dropdowns. This resulted in:
1. **Excessive Visual Clutter:** The transcript reading experience was disrupted by form-heavy administrative controls.
2. **High Cognitive Load:** Reviewing multiple speakers simultaneously in a vertical stack overwhelmed users with simultaneous audio players, quotes, and dropdowns.
3. **Hidden / Awkward Discovery:** Users expected speaker identification to be a high-level meeting property accessible directly from the meeting title header metadata rather than tucked away inside the transcript section.

---

## 2. Goals & Anti-Goals

### Goals
- **Quiet, Natural Header Entry Point:** Provide a subtle, clickable metadata indicator under the meeting title (`September 5, 2026 · 2 participants · 2 unidentified speakers`) that opens the identification flow.
- **Focused, One-by-One Modal Flow:** Present unidentified speakers in a sleek, focused modal dialog, reviewing one speaker at a time with a clear progress indicator (`Speaker 1 of 2`).
- **Rich Context per Speaker:** For each speaker, display the turn count, a representative quotation excerpt, an on-demand voice sample player, 1-click suggested attendee chips from the calendar, and a person search/create dropdown.
- **Smooth Navigation & Fast Triage:** Confirming or clicking an attendee chip immediately saves the binding and auto-advances to the next speaker. Users can step backwards with a `Back` button, `Skip` unconfirmed speakers, or cancel with `Esc`.
- **Transcript Cleanliness:** Remove the stacked accordion from above the transcript entirely, while preserving the ability to click any `Speaker N` turn tag directly in the transcript to open the modal pre-focused on that speaker.
- **Real-Time Display Updates:** Bound speakers update immediately in transcript turns (`<Name> (You)` or `<Name>`) without page reloads.

### Anti-Goals
- We are not automatically assigning remote speakers without user confirmation.
- We are not changing backend schema or identity reconciliation workers; this design builds on the existing `getMeetingIdentity`, `setMeetingIdentityBinding`, and `getMeetingSpeakerSample` APIs.

---

## 3. UI/UX Specification (Notion / Linear Merger Aesthetic)

### A. Meeting Document Subtext Trigger
In `MeetingView.tsx`, the header metadata row (`.meeting-document-meta`) renders:
```tsx
<span>{formattedDate}</span>
{participantCount > 0 ? <span>{participantCount} participants</span> : null}
{unidentifiedCount > 0 ? (
  <button
    type="button"
    onClick={() => setSpeakerModalOpen(true)}
    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
  >
    <span>·</span>
    <Users size={12} className="opacity-70" />
    <span>{unidentifiedCount} unidentified {unidentifiedCount === 1 ? 'speaker' : 'speakers'}</span>
  </button>
) : null}
```
When all speakers are confirmed, this trigger is cleanly omitted (or optionally displays a muted status if reviewed in the current session).

### B. One-by-One Speaker Identification Modal
A dedicated component `SpeakerIdentificationModal.tsx`:
- **Backdrop:** Fixed overlay (`fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in`).
- **Dialog Container:** Linear-style modal card (`w-full max-w-lg rounded-xl border border-pro-border bg-pro-surface shadow-2xl overflow-hidden`).
- **Modal Header:**
  - Left: Title `Identify Speakers` + Step pill `Speaker {currentStep + 1} of {totalSpeakers}`.
  - Right: Close button with `Esc` shortcut badge.
- **Modal Body (Active Speaker Card):**
  - **Speaker Heading:** `Speaker N` with turn badge (`{turnCount} turns in this meeting`).
  - **Representative Quote:** Styled excerpt blockquote (`rounded-lg border border-pro-border/60 bg-pro-bg/50 px-3.5 py-2.5 text-[13px] italic font-serif leading-relaxed`).
  - **Voice Sample Button:** Pill button with `Play` / `Pause` / `Loading` states for the isolated audio sample, plus "Try another sample" when multiple samples exist.
  - **Quick Attendee Suggestions:** If invited calendar attendees exist (excluding workspace self and aliases):
    - Displayed as 1-click suggestion chips: `[ + Jordan Doe ]`, `[ + Alex Chen ]`.
    - Clicking an attendee chip immediately binds the speaker and advances to the next step.
  - **Search / Select Dropdown:**
    - Dropdown with existing People in the workspace.
    - Option to "Create a distinct person…" which reveals a clean name text input.
- **Modal Footer:**
  - Left: `Back` button (visible on step > 0).
  - Right:
    - `Skip` button (moves to next speaker without binding).
    - `Confirm & Next` button (active when a person is selected or typed).
- **Completion / Summary Step:**
  - When all speakers are completed:
    - Title: `All speakers reviewed`.
    - List of reviewed speakers with their confirmed names and an `Undo` button.
    - Primary button: `Done` (closes the modal).

### C. In-Transcript Click Affordance
- In `MeetingView.tsx`, clicking an unresolved `Speaker N` turn badge opens `SpeakerIdentificationModal` with `initialSpeaker: speaker`, jumping directly to that speaker's step.

### D. Clean Transcript Surface
- Remove `MeetingIdentityControls` accordion from above the transcript. The transcript record begins cleanly with turn rows or time filters.

---

## 4. Technical Architecture & Component Breakdown

1. **`src/components/features/SpeakerIdentificationModal.tsx`:**
   - Standalone modal component managing:
     - `stepIndex: number`
     - Audio sample playback and cleanup via `getMeetingSpeakerSample` and `URL.createObjectURL` / `revokeObjectURL`.
     - Identity mutations via `setMeetingIdentityBinding` and `clearMeetingIdentityBinding`.
     - Live display name notification via `onDisplayNamesChange`.
     - Keyboard listeners: `Escape` to close, `Enter` to confirm, Arrow navigation.
2. **`src/components/features/MeetingView.tsx`:**
   - Integrate `unidentifiedCount` into the `meeting-document-meta` row.
   - Manage `isSpeakerModalOpen` state and `selectedSpeakerForModal` focus state.
   - Pass `speakerSummaries`, `attendeeNames`, and `hasSystemAudio` to the modal.
3. **Styles (`src/index.css`):**
   - Clean utilities for modal animation and pill chips matching existing Linear/Notion design tokens.

---

## 5. Verification Plan

1. **Unit & DOM Tests:**
   - DOM tests verifying the header metadata button renders with correct speaker count and clicks open the modal.
   - DOM tests verifying step-by-step navigation (Next, Skip, Back, 1-click attendee chip auto-advance).
   - Verification that workspace user and aliases are excluded from suggested chips.
   - Verification of audio sample playback lifecycle and cleanup.
   - In-transcript speaker badge click opening modal with targeted speaker.
2. **Code Quality:**
   - `npx tsc --noEmit` clean.
   - `pnpm run lint` clean.
   - Changelog validation and durable decision logging.
