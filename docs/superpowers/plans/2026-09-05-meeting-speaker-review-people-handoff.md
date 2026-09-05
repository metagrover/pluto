# Meeting Speaker Review and People Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users review anonymous remote speakers with trusted System-audio samples, bind them to calendar attendees or People, and have People reflect only explicit confirmed identity evidence.

**Architecture:** Keep `Remote Speaker N` in persisted transcripts and centralize its presentation as `Speaker N`. Add a meeting-scoped sample service that derives bounded WAV bytes from the persisted System artifact without accepting renderer paths. Treat calendar attendees as roster hints and confirmed identity bindings as a derived People evidence source rather than mutating transcript evidence.

**Tech Stack:** Electron IPC, React 18, TypeScript, better-sqlite3, fluent-ffmpeg, Vitest, React DOM tests.

---

### Task 1: Anonymous speaker presentation and sample selection

**Files:**
- Create: `src/utils/speakerReview.ts`
- Create: `tests/unit/speakerReview.test.ts`
- Modify: `src/components/features/meetingTranscriptPresentation.ts`
- Modify: `tests/unit/meetingTranscriptPresentation.test.ts`

- [x] **Step 1: Write failing pure tests**

Cover canonical recognition, display projection, numbered-placeholder rejection, deterministic grouping of adjacent same-speaker turns, exclusion of overlaps, duration bounds, and indexed alternate samples:

```ts
expect(getAnonymousSpeakerDisplayLabel('Remote Speaker 2')).toBe('Speaker 2');
expect(isGenericSpeakerLabel('Speaker 2')).toBe(true);
expect(selectSpeakerSampleIntervals(segments, 'Remote Speaker 1')).toEqual([
  { startSec: 10, endSec: 16, excerpt: 'I will send the proposal.' },
]);
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/unit/speakerReview.test.ts tests/unit/meetingTranscriptPresentation.test.ts`

Expected: failure because `speakerReview.ts` and anonymous display projection do not exist.

- [x] **Step 3: Implement the pure boundary**

Export explicit functions and a bounded return type:

```ts
export interface SpeakerSampleInterval {
  startSec: number;
  endSec: number;
  excerpt: string;
}

export const getAnonymousSpeakerDisplayLabel = (speaker: string): string;
export const isGenericSpeakerLabel = (value: unknown): boolean;
export const selectSpeakerSampleIntervals = (
  segments: Array<{ speaker?: string; text?: string; start: number; end: number }>,
  speaker: string,
  limit?: number,
): SpeakerSampleInterval[];
```

Use 5–8 second clean groups when available, accept a minimum two-second clean fallback, return at most two non-overlapping candidates, and never join across another speaker's overlapping interval.

- [x] **Step 4: Apply display-only projection and verify GREEN**

Make transcript presentation convert only canonical `Remote Speaker N` labels to `Speaker N`; confirmed person projection continues to take precedence. Run the focused tests and expect both files to pass.

- [x] **Step 5: Commit**

```bash
git add src/utils/speakerReview.ts src/components/features/meetingTranscriptPresentation.ts tests/unit/speakerReview.test.ts tests/unit/meetingTranscriptPresentation.test.ts
git commit -m "feat: project anonymous speaker review labels"
```

### Task 2: Secure meeting-scoped voice sample IPC

**Files:**
- Create: `electron/speakerSample.ts`
- Create: `tests/unit/speakerSample.test.ts`
- Modify: `electron/main.ts`
- Modify: `src/api/identity.ts`
- Modify: `src/components/features/MeetingView.tsx`

- [x] **Step 1: Write failing service tests**

Inject meeting lookup, file existence, WAV slicing, reading, and cleanup. Prove that the service accepts only `{ meetingId, speaker, sampleIndex }`, resolves `system_audio_path` from the saved meeting, validates the canonical speaker against saved transcript segments, caps output bytes, and removes the temporary file on success and failure.

```ts
const result = await loadSpeakerSample(
  { meetingId: 'meeting-a', speaker: 'Remote Speaker 1', sampleIndex: 0 },
  deps,
);
expect(result).toMatchObject({ mimeType: 'audio/wav', durationSeconds: 6 });
expect(result?.bytes).toBeInstanceOf(Uint8Array);
```

- [x] **Step 2: Run the service test and verify RED**

Run: `pnpm exec vitest run tests/unit/speakerSample.test.ts`

Expected: failure because the service is missing.

- [x] **Step 3: Implement and register the service**

Create `loadSpeakerSample()` with a 10 MiB response cap, two-sample index bound, content-free errors, and `finally` cleanup. Register `GET_MEETING_SPEAKER_SAMPLE` in Electron using the existing FFmpeg configuration. Do not reuse the unrestricted `AUDIO_SLICE_WAV` renderer contract.

- [ ] **Step 4: Add the renderer API and meeting props**

Add:

```ts
export const getMeetingSpeakerSample = (
  meetingId: string,
  speaker: string,
  sampleIndex: number,
) => invoke<SpeakerSample | null>('GET_MEETING_SPEAKER_SAMPLE', {
  meetingId,
  speaker,
  sampleIndex,
});
```

Pass only the meeting ID and whether the meeting has a System artifact into identity controls; never pass a local audio path.

- [x] **Step 5: Verify GREEN and commit**

Run the sample service and identity API tests, then commit the new service, registration, API, and prop wiring.

### Task 3: Separate calendar roster hints from manual People persistence

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AudioManager.tsx`
- Modify: `tests/unit/calendarMeetingPrompt.test.ts`
- Modify: `tests/unit/autoStopJournalSeal.test.ts`
- Modify: `tests/unit/calendarApi.test.ts`

- [x] **Step 1: Write failing tests**

Prove that calendar-start flows provide attendee names to transcription vocabulary while saved `participants` contain only user-entered participants. Add a regression assertion that the active matcher consumes `kind: 'matched'`, not `kind: 'match'`.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/unit/calendarMeetingPrompt.test.ts tests/unit/autoStopJournalSeal.test.ts tests/unit/calendarApi.test.ts`

- [x] **Step 3: Add the roster-hint boundary**

Introduce an `AudioManager` prop:

```ts
transcriptionParticipantHints?: string[];
```

Use the deduplicated union of manual participants and calendar roster names only for `GET_TRANSCRIPTION_VOCABULARY`. Continue persisting only the manual `participants` prop. Stop copying attendees into `meetingParticipants` in `App.tsx`, and correct the matcher result discriminator to `matched`.

- [x] **Step 4: Verify GREEN and commit**

Run the focused calendar/recording tests and commit the roster semantics change.

### Task 4: Make confirmed bindings authoritative in People without placeholder leakage

**Files:**
- Modify: `src/utils/personBriefing.ts`
- Modify: `electron/db.ts`
- Modify: `electron/identityHandlers.ts`
- Modify: `tests/unit/personBriefing.test.ts`
- Modify: `tests/unit/personIdentityDb.test.ts`
- Modify: `tests/unit/dbTranscriptionPersonCandidates.test.ts`
- Modify: `tests/unit/identityHandlers.test.ts`

- [x] **Step 1: Write failing trust tests**

Assert that numbered generic speaker labels are rejected, confirmed bindings contribute to People summary meeting counts and meeting-scoped person IDs, invited-only calendar attendees remain scheduled, and clearing a binding removes only binding-derived confirmed evidence.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/unit/personBriefing.test.ts tests/unit/personIdentityDb.test.ts tests/unit/dbTranscriptionPersonCandidates.test.ts tests/unit/identityHandlers.test.ts`

- [x] **Step 3: Implement derived binding evidence**

Use the shared generic-label predicate in `isUsablePersonName`. Extend People summary and `getPersonEntityIdsForMeeting()` queries to union canonical person IDs from valid individual `identity_bindings`. Do not insert synthetic `meeting_entities` rows. Keep detail precedence `confirmed > scheduled > mentioned` and make binding clear automatically remove the derived relationship.

- [x] **Step 4: Refresh affected person context after mutations**

Return mutation metadata or invoke the existing bounded knowledge-refresh path after a successful binding change without blocking the transaction. Ensure failure to refresh cannot roll back or erase the saved correction.

- [x] **Step 5: Verify GREEN and commit**

Run the focused database and identity tests, then commit.

### Task 5: Build the speaker-review interaction

**Files:**
- Modify: `src/components/features/MeetingIdentityControls.tsx`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests**

Cover `N unidentified speakers · Review`, `Speaker N` rows, excerpts, one-at-a-time playback, alternate sample, invited labels, selection confirmation copy, immediate name projection, object-URL cleanup, unavailable audio, stale revisions, and Undo/clear.

- [ ] **Step 2: Run the DOM test and verify RED**

Run: `pnpm exec vitest run tests/unit/IdentityControls.dom.test.tsx`

- [ ] **Step 3: Implement the compact review UI**

Replace the current form-first anonymous-speaker treatment with a progressively disclosed review list. Keep existing correction capability for non-anonymous speakers behind the same section. Load audio only after a user presses Play, build a `Blob` from returned bytes, revoke prior URLs before switching, and stop playback on meeting change/unmount.

- [ ] **Step 4: Implement explicit confirmation and Undo**

Selecting a candidate must stage the choice rather than save immediately. Show the projected display name, affected turn count, and People consequence; confirm through the existing revision-safe binding API. After success, publish display names immediately and expose a bounded Undo action that clears the exact saved binding revision.

- [ ] **Step 5: Verify behavior and commit**

Run the DOM and meeting presentation tests, inspect the rendered layout in Electron when available, and commit the UI changes.

### Task 6: Documentation and complete verification

**Files:**
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-09-04-747-proactive-calendar-auto-stop.md`
- Modify: `docs/superpowers/plans/2026-09-05-meeting-speaker-review-people-handoff.md`

- [ ] **Step 1: Record the durable trust decision**

Document that calendar invitees are roster evidence, confirmed bindings are direct People evidence, anonymous labels stay canonical, and voice samples are ephemeral local review aids.

- [ ] **Step 2: Update the shipped summary**

Extend the existing #747 changelog fragment with the user outcome and link #755 as the deferred persistent-recognition work.

- [ ] **Step 3: Run verification**

Run focused suites after each task, then:

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
pnpm test -- --run
git diff --check
```

Run `pnpm run ensure:sqlite-abi` before any Electron/package validation if Node tests rebuilt `better-sqlite3` for the Node ABI.

- [ ] **Step 4: Review and delivery**

Review the complete diff against the approved spec, update PR #754’s description and verification section, push `feat/747-proactive-calendar`, and confirm the remote head SHA.
