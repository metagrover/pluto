# Thin Meeting Refresh Implementation Plan

**Goal:** Keep meeting lists and notes progress responsive as the corpus grows by transferring bounded summaries and loading full private detail only for the selected meeting.

**Architecture:** Add a database-owned `MeetingSummary` projection with explicit columns and separate bounded dashboard and processing-status reads. The renderer keeps summaries separately from one selected detail record. Selection uses a request generation guard so stale detail cannot replace a newer choice. Existing `MEETING_NOTES_UPDATED` events carry the meeting ID and trigger a bounded status/detail refresh; the two-second full-corpus poll is removed. Search moves to a purpose-built database query so note text remains searchable without entering the global renderer list.

**Privacy and trust:** Summary rows exclude transcript, analysis, enhanced notes, user notes, edit snapshots, and audio paths. Derived preview strings are length-bounded. No new global cache stores meeting content. Transcript/finalization and notes-publication contracts are unchanged.

---

### Task 1: Define and benchmark the summary read model

**Files:**
- Modify: `electron/db.ts`
- Create: `tests/unit/dbMeetingSummaries.test.ts`
- Create: `scripts/lib/meeting_summary_benchmark.ts`
- Create: `tests/unit/meetingSummaryBenchmark.test.ts`

- [x] Write RED tests proving summary rows preserve ordering/status metadata and omit every detail-only field.
- [x] Implement an explicit SQL projection and separate bounded preview/status fields.
- [x] Write a synthetic 100-meeting payload test with very large transcripts and analyses.
- [x] Require serialized summaries below 100 KB and invariant to transcript growth.

### Task 2: Make GET_MEETINGS summary-only and keep GET_MEETING as detail

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/types.ts`
- Modify: `src/utils/browserIpcFallback.ts`
- Test: `tests/unit/browserIpcFallback.test.ts`
- Test: `tests/unit/meetingSummaryIpc.test.ts`

- [x] Add a typed summary contract and return only summaries from `GET_MEETINGS`.
- [x] Keep `GET_MEETING` as the sole full-detail meeting read.
- [x] Add a bounded `GET_MEETING_STATUS` projection for progress events.
- [x] Keep browser-preview fixtures compatible with all reads.

### Task 3: Load selected detail safely and remove full-corpus progress polling

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/features/MeetingView.tsx`
- Create: `src/services/selectedMeetingDetail.ts`
- Create: `tests/unit/selectedMeetingDetail.test.ts`
- Modify: relevant DOM tests

- [x] Write RED tests for stale selection responses and bounded status merging.
- [x] Store summaries plus one selected detail record; never a global detail map.
- [x] Fetch detail on selection and ignore a response if the selection generation changed.
- [x] Replace MeetingView's two-second `GET_MEETINGS` interval with `MEETING_NOTES_UPDATED` status/detail refreshes.
- [x] Fetch a single detail before automatic finalization or downstream processing requires transcript/audio data.

### Task 4: Preserve search and dashboard behavior without list blobs

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/overlays/searchPlutoModel.ts`
- Modify: `src/components/features/dashboardModel.ts`
- Test: relevant search/dashboard/database tests

- [x] Move meeting note/title search to a bounded database query returning result metadata only.
- [x] Add a separate bounded dashboard preview read for latest-meeting and recent-win presentation.
- [x] Preserve ordering, recording finalization, deletion, and selection flows.

### Task 5: Document, verify, and deliver

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-01-724-thin-meeting-refresh.md`

- [x] Document the summary/detail/event boundary and measured payload gate.
- [x] Run focused tests and the 100-meeting payload benchmark.
- [x] Run full Vitest, TypeScript, lint, production build, changelog check, production-dependency high audit, and diff check.
- [x] Restore and verify Electron SQLite ABI.
- [x] Commit, push, and open a focused PR linked to #724.
