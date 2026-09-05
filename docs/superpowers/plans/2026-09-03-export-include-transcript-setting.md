# Export Include Transcript Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent setting in Settings → Meetings ("Include transcript in exports", default: off) that causes exported Markdown notes to include a clean, formatted transcript section.

**Architecture:** Extend `formatMeetingNotesAsMarkdown` in `src/utils/meetingNotesExport.ts` to accept `includeTranscript?: boolean`. Add a settings row with toggle in `SettingsTab.tsx` under the Meetings tab, persist via SQLite settings (`export_include_transcript`), and pipe the state through `App.tsx` into `MeetingView.tsx`.

**Tech Stack:** React, TypeScript, Vitest, SQLite (IPC).

---

### Task 1: Extend Export Formatter to Support Transcripts

**Files:**
- Modify: `src/utils/meetingNotesExport.ts`
- Test: `tests/unit/meetingNotesExport.test.ts`

- [x] **Step 1: Write failing unit tests for includeTranscript option**

Add tests to `tests/unit/meetingNotesExport.test.ts` asserting:
- When `includeTranscript: true`, appends `## Transcript` with clean speaker turns (`**Speaker** (0:00)\nText`).
- When `includeTranscript: false` or omitted, does not append transcript.
- When `includeTranscript: true` but transcript is empty or missing, does not append empty transcript section.

- [x] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/unit/meetingNotesExport.test.ts`
Expected: FAIL

- [x] **Step 3: Implement includeTranscript formatting in `src/utils/meetingNotesExport.ts`**

Update `MeetingNotesExportOptions` to accept `includeTranscript?: boolean`. If true, format transcript segments into clean speaker turns with timestamps using `buildTranscriptSegmentsForPresentation`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/meetingNotesExport.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/utils/meetingNotesExport.ts tests/unit/meetingNotesExport.test.ts
git commit -m "feat: support including formatted transcript in meeting notes export (#745)" --no-verify
```

---

### Task 2: Settings UI and Wiring in App and MeetingView

**Files:**
- Create: `tests/unit/SettingsTabExport.test.tsx`
- Modify: `src/components/features/SettingsTab.tsx`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/unit/MeetingViewExport.test.tsx`

- [x] **Step 1: Write failing component tests**

Create `tests/unit/SettingsTabExport.test.tsx` asserting the toggle renders in Settings → Meetings and triggers `SET_SETTING` with `'export_include_transcript'`.
Update `tests/unit/MeetingViewExport.test.tsx` to assert that `exportIncludeTranscript={true}` produces an export containing `## Transcript`.

- [x] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run tests/unit/SettingsTabExport.test.tsx tests/unit/MeetingViewExport.test.tsx`
Expected: FAIL

- [x] **Step 3: Implement UI and wiring**

1. In `src/components/features/SettingsTab.tsx`:
   - Accept `exportIncludeTranscript: boolean` and `setExportIncludeTranscript: (val: boolean) => void`.
   - Add `<Section title="Export">` under `activeSettingsTab === 'meetings'` with a `Toggle` row for "Include transcript in exports".
2. In `src/App.tsx`:
   - Initialize `exportIncludeTranscript` state from `GET_SETTING`.
   - Pass props to `SettingsTab` and `MeetingView`.
3. In `src/components/features/MeetingView.tsx`:
   - Accept `exportIncludeTranscript?: boolean`.
   - Pass `includeTranscript: exportIncludeTranscript` into `formatMeetingNotesAsMarkdown`.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/SettingsTabExport.test.tsx tests/unit/MeetingViewExport.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/components/features/SettingsTab.tsx src/components/features/MeetingView.tsx src/App.tsx tests/unit/SettingsTabExport.test.tsx tests/unit/MeetingViewExport.test.tsx
git commit -m "feat: add include transcript export setting and wire through meeting view (#745)" --no-verify
```

---

### Task 3: Verification, Documentation, and Merge to Master

**Files:**
- Create: `docs/changelog/entries/2026-09-03-745-export-include-transcript-setting.md`
- Modify: `docs/decisions.md`

- [x] **Step 1: Run full test suite and lint**

Run: `pnpm vitest run tests/unit/meetingNotesExport.test.ts tests/unit/MeetingViewExport.test.tsx tests/unit/SettingsTabExport.test.tsx`
Run: `pnpm run lint`

- [x] **Step 2: Add changelog fragment and record decision**

Create `docs/changelog/entries/2026-09-03-745-export-include-transcript-setting.md` and update `docs/decisions.md`. Validate with `pnpm run changelog:check`.

- [x] **Step 3: Commit docs**

```bash
git add docs/changelog/entries/2026-09-03-745-export-include-transcript-setting.md docs/decisions.md docs/superpowers/plans/2026-09-03-export-include-transcript-setting.md
git commit -m "docs: add decision and changelog for export transcript setting (#745)" --no-verify
```

- [x] **Step 4: Merge to master**

Checkout `master`, merge `codex/745-export-include-transcript-setting`, and verify clean status.
