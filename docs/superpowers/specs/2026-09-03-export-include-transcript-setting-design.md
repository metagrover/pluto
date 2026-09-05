# Setting to Include Transcript in Meeting Notes Export Design

Issue: #745

## Goal

Provide a persistent user setting in Settings (under Meetings) that allows users to optionally include the transcript when exporting meeting notes. When enabled, every meeting notes export appends a clean, human-readable transcript section after the notes. The setting defaults to disabled (off).

## Outcome

1. **User Setting**:
   - Located in **Settings → Meetings** under a new **Export** section.
   - Toggle labeled **"Include transcript in exports"** with helper copy **"Append the speaker-attributed transcript to exported Markdown notes."**
   - Defaults to `false` (disabled).
   - Persisted via `SET_SETTING` under the key `export_include_transcript`.
2. **Export Behavior**:
   - When disabled: Meeting notes export retains current behavior (notes, user edits, and metadata only).
   - When enabled: The exported Markdown file appends a `## Transcript` section at the bottom, containing speaker-attributed turns with timestamps (`m:ss`), completely avoiding raw JSON.

## Architecture & Implementation

### 1. Settings State & Persistence
- **Storage**: SQLite `settings` table via existing IPC channels `GET_SETTING` and `SET_SETTING` with key `'export_include_transcript'`.
- **`App.tsx`**:
  - Initializes `exportIncludeTranscript` state (default `false`) from `GET_SETTING`.
  - Passes `exportIncludeTranscript` and `setExportIncludeTranscript` to `SettingsTab` and `MeetingView`.
- **`SettingsTab.tsx`**:
  - Under `activeSettingsTab === 'meetings'`, add an `Export` `<Section>` with a `SettingsRow` containing a `Toggle`.
  - On change, updates React state and invokes `persistSetting('export_include_transcript', next ? 'true' : 'false')`.

### 2. Export Formatter Extension (`src/utils/meetingNotesExport.ts`)
- Extend `MeetingNotesExportOptions`:
  ```typescript
  export interface MeetingNotesExportOptions {
    meeting: Meeting;
    documentModel: MeetingNotesDocumentModel;
    calendarContext?: MeetingCalendarContext | null;
    transcriptSegments?: TranscriptSegment[];
    includeTranscript?: boolean;
  }
  ```
- If `options.includeTranscript` is true and transcript content exists:
  - Formats segments into speaker turns (using presentation segments or turns):
    ```markdown
    ---

    ## Transcript

    **[Speaker]** ([m:ss])
    [Spoken text]
    ```
  - Omits the section if no transcript segments exist.

### 3. UI Integration in `MeetingView.tsx`
- Receives `exportIncludeTranscript?: boolean` prop (default `false`).
- Passes `includeTranscript: exportIncludeTranscript` into `formatMeetingNotesAsMarkdown`.

## Testing Plan

### Automated Unit Tests (`tests/unit/meetingNotesExport.test.ts`)
- Verifies that `includeTranscript: false` (default) does not append a transcript section.
- Verifies that `includeTranscript: true` appends `## Transcript` with formatted speaker, timestamp, and text.
- Verifies that empty transcripts do not render a trailing empty heading.

### Component Integration Tests
- `tests/unit/MeetingViewExport.test.tsx`: Asserts that when `exportIncludeTranscript={true}`, exported content includes the formatted transcript.
- `tests/unit/SettingsTabExport.test.tsx`: Asserts that the "Include transcript in exports" toggle renders, reflects initial state, and persists updates.

## Non-Goals
- No raw JSON transcript dump option (the output must always remain human-readable).
- No per-export prompt (the setting acts as a global default preference).
