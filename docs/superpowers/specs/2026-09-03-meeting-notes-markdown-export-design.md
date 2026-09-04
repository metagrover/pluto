# Meeting Notes Markdown Export Design

Issue: #744

## Goal

Improve the existing "Export meeting" action in the meeting document menu to export a clean, beautifully formatted Markdown file (`.md`). The export must contain meeting metadata, calendar context (if matched), attendees/speakers, and the structured meeting notes reflecting any user edits. It must strictly exclude raw transcript JSON and internal debug data.

## Outcome

When a user clicks "Export as Markdown" under the meeting actions (`...`) menu:
1. A Markdown file named `[sanitized-meeting-title]-[YYYY-MM-DD].md` (falling back to `pluto-session-[id]-[YYYY-MM-DD].md`) is downloaded.
2. The file begins with a structured metadata header:
   - Meeting title (`# Title`)
   - Date and local time
   - Duration (e.g. `45 min`)
   - Calendar context when matched (Event title, calendar name, organizer, attendee list)
   - Detected participant speakers when no calendar attendees are present or to complement them
3. The file body contains the unified meeting notes derived from the active `MeetingNotesDocumentModel`:
   - `## Decisions & next steps` with checkmarks (`- [x]` or `- [ ]`), assignees, and due dates
   - `## Overview` summary paragraph
   - `## [Topic Title]` sections with summary and bullet points (including speaker tags)
   - `## Open questions` (if present)
   - Any inline user edits or continued rows placed in their respective sections
   - If no AI notes exist, user scratchpad notes are exported directly as the primary body
4. Raw transcript JSON, model generation hashes, and internal technical parameters are completely excluded.

## Architecture & Implementation

### 1. Dedicated Export Serializer (`src/utils/meetingNotesExport.ts`)

A pure, decoupled utility function responsible for transforming the meeting state into clean Markdown:

```typescript
export interface MeetingNotesExportOptions {
  meeting: Meeting;
  documentModel: MeetingNotesDocumentModel;
  calendarContext?: MeetingCalendarContext | null;
  transcriptSegments?: TranscriptSegment[];
}

export function formatMeetingNotesAsMarkdown(options: MeetingNotesExportOptions): string;
export function buildMeetingExportFilename(title: string, date: string | number | Date, id: string | number): string;
```

#### Filename Generation Logic:
- Strips illegal filesystem characters (`/ \ : * ? " < > |`) and punctuation.
- Converts spaces and dashes into clean hyphens (e.g. `product-sync-2026-09-03.md`).
- Truncates excessively long titles to 60 characters.
- If title is missing or resolves empty, falls back to `pluto-session-[id]-[YYYY-MM-DD].md`.

#### Metadata & Attendee Resolution:
- Date formatted in readable local convention (e.g. `September 3, 2026 at 6:30 PM`).
- If `calendarContext` is provided:
  - Event title and calendar name: `- **Calendar Event:** [Title] ([Calendar Name])`
  - Organizer: `- **Organizer:** [Name/Email]`
  - Attendees: `- **Attendees:** [Comma-separated attendee names/emails]`
- Participant Speakers:
  - Extracted from `transcriptSegments` (ignoring "Unknown" or blank).
  - If attendees were already listed from the calendar, only novel speakers or non-redundant names are noted, or labeled `- **Detected Speakers:** ...`.

#### Section Serialization:
- Iterates over `documentModel.sections` (ignoring empty sections).
- Skips standalone `scratchpad` section if `hasAnalysis` is true (since notes were synthesized into topics and inline blocks).
- Formats outcomes with GitHub-flavored Markdown checkboxes (`- [ ]` / `- [x]`), assignees (`(Assignee: ...)`), and due dates (`(Due: ...)`).
- Formats topics with `## [Topic Title]`, followed by topic summaries and bullet points with speaker attribution.
- Retains all user edits from `editsMap` already integrated in `documentModel`.

### 2. UI Update in `MeetingView.tsx`

- In the `...` menu panel:
  - Update the action button label to **"Export as Markdown"**.
  - Accessible `aria-label="Export as Markdown"`.
  - Use `formatMeetingNotesAsMarkdown({ meeting: selectedMeeting, documentModel: notesDocument, calendarContext, transcriptSegments })`.
  - Trigger browser download with MIME type `text/markdown;charset=utf-8` and `.md` file extension.

## Testing Plan

### Automated Unit Tests (`tests/unit/meetingNotesExport.test.ts`)
- **Metadata formatting**: Verifies date, duration, calendar context (organizer, attendees), and transcript speaker fallbacks.
- **Section structure**: Verifies output contains `# Title`, `## Decisions & next steps` with `- [ ]` / `- [x]`, `## Overview`, `## [Topics]`.
- **User edit preservation**: Confirms in-place edited text and completed statuses appear in the exported markdown.
- **Transcript exclusion**: Asserts that raw JSON, timestamp objects, and transcript turns are never leaked into the output.
- **No-analysis fallback**: Confirms that when `hasAnalysis: false`, user notes are cleanly formatted as the meeting notes body.
- **Filename sanitization**: Tests special characters, empty titles, long titles, and date formatting.

### Component Integration Tests (`tests/unit/MeetingView.test.tsx`)
- Verifies that clicking "Export as Markdown" invokes the export with the expected file attributes and content.

## Non-Goals

- No PDF generation library or export modal dialog (keeping the workflow lightweight and zero-overhead).
- No server-side export endpoint (pure client-side execution preserves privacy).
