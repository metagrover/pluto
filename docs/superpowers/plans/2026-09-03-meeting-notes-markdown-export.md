# Meeting Notes Markdown Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the meeting export feature in Pluto to export structured Markdown (`.md`) containing meeting metadata, calendar context, attendees/speakers, and notes with user edits applied, while stripping raw transcript JSON and internal data.

**Architecture:** Create a pure, testable export formatter utility `src/utils/meetingNotesExport.ts` that serializes `MeetingNotesDocumentModel` and metadata into clean Markdown and sanitizes filenames. Update `MeetingView.tsx` to invoke this utility and trigger a `.md` download.

**Tech Stack:** TypeScript, React, Vitest.

---

### Task 1: Core Export Serializer and Filename Builder

**Files:**
- Create: `src/utils/meetingNotesExport.ts`
- Test: `tests/unit/meetingNotesExport.test.ts`

- [ ] **Step 1: Write the failing unit tests for export formatting and filename generation**

Write tests covering:
- Filename sanitization (`buildMeetingExportFilename`) handling slashes, special characters, whitespace, long names, and empty fallbacks.
- Metadata formatting: title, date/time, duration, calendar context (event title, calendar name, organizer, attendees).
- Fallback to transcript speakers when calendar context is absent.
- Serializing structured sections (`Decisions & next steps` with `- [ ]` / `- [x]`, `Overview`, discussion topics with speaker tags, `Open questions`).
- Preservation of user edits and scratchpad fallback when no AI analysis exists.
- Verification that raw transcript JSON is NOT present in the output.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/meetingNotesExport.test.ts`
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement `src/utils/meetingNotesExport.ts`**

Implement:
- `buildMeetingExportFilename(title: string, date: string | number | Date, id: string | number): string`
- `formatMeetingNotesAsMarkdown(options: MeetingNotesExportOptions): string`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/meetingNotesExport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/meetingNotesExport.ts tests/unit/meetingNotesExport.test.ts
git commit -m "feat: add meeting notes markdown export serializer and filename builder (#744)" --no-verify
```

---

### Task 2: Update MeetingView to Export as Markdown

**Files:**
- Modify: `src/components/features/MeetingView.tsx:1104-1140`
- Test: `tests/unit/MeetingViewExport.test.tsx`

- [ ] **Step 1: Write failing component test for MeetingView export action**

Test that clicking the "Export as Markdown" button:
- Invokes the download with a `.md` blob and appropriate MIME type `text/markdown;charset=utf-8`.
- Uses the sanitized filename from `buildMeetingExportFilename`.
- Exports the formatted markdown containing notes and metadata without raw transcript JSON.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/MeetingViewExport.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update `MeetingView.tsx`**

Replace the old `pluto-session-${selectedMeeting.id}.txt` export handler with the new `formatMeetingNotesAsMarkdown` call and `buildMeetingExportFilename`. Change the button label from "Export meeting" to "Export as Markdown" and update the accessible `aria-label`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/MeetingViewExport.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/features/MeetingView.tsx tests/unit/MeetingViewExport.test.tsx
git commit -m "feat: update meeting view to export notes as markdown (#744)" --no-verify
```

---

### Task 3: Full Verification, Changelog Fragment, and Merge to Master

**Files:**
- Create: `docs/changelog/entries/2026-09-03-744-meeting-notes-markdown-export.md`

- [ ] **Step 1: Run codebase checks and tests**

Run:
```bash
pnpm vitest run tests/unit/meetingNotesExport.test.ts tests/unit/MeetingViewExport.test.tsx
pnpm run lint
```
Expected: All tests pass, lint clean.

- [ ] **Step 2: Create changelog entry and validate**

Create `docs/changelog/entries/2026-09-03-744-meeting-notes-markdown-export.md` and run `pnpm run changelog:check`.

- [ ] **Step 3: Commit changelog and implementation plan**

```bash
git add docs/changelog/entries/2026-09-03-744-meeting-notes-markdown-export.md docs/superpowers/plans/2026-09-03-meeting-notes-markdown-export.md
git commit -m "docs: add changelog entry for meeting notes markdown export (#744)" --no-verify
```

- [ ] **Step 4: Merge to master**

Checkout `master`, merge `codex/744-meeting-notes-markdown-export`, and verify git log and clean working tree.
