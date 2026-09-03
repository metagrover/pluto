import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('meeting summary IPC boundary', () => {
  it('routes list, status, and detail reads to separate database projections', () => {
    const source = readFileSync('electron/main.ts', 'utf8');

    expect(source).toContain(
      "ipcMain.handle('GET_MEETINGS', () => db.getMeetingSummaries())",
    );
    expect(source).toContain(
      "ipcMain.handle('GET_MEETING_STATUS', (_event, id) =>",
    );
    expect(source).toContain(
      "ipcMain.handle('GET_MEETING_PROCESSING_STATUSES', () =>",
    );
    expect(source).toContain('db.getMeetingSummary(id)');
    expect(source).toContain('withNotesRun(db.getMeeting(id))');

    const databaseSource = readFileSync('electron/db.ts', 'utf8');
    const summaryProjection = databaseSource.slice(
      databaseSource.indexOf('export const getMeetingSummaries'),
      databaseSource.indexOf('const readMeetingProcessingStatus'),
    );
    expect(summaryProjection).not.toContain('transcript_integrity_json');

    const meetingViewSource = readFileSync(
      'src/components/features/MeetingView.tsx',
      'utf8',
    );
    expect(meetingViewSource).not.toMatch(
      /setInterval\(\(\) => fetchMeetings\(\), 2_000\)/,
    );
  });
});
