import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sliceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('meeting context IPC boundary', () => {
  const main = readFileSync('electron/main.ts', 'utf8');

  it('registers the confirmed-segment producer', () => {
    expect(main).toContain("'MEETING_CONTEXT_INGEST_CONFIRMED'");
    expect(main).toContain('createMeetingContextProducer({');
  });

  it('requires the recording lease without depending on the finishing EOU owner', () => {
    const handler = sliceBetween(
      main,
      "'MEETING_CONTEXT_INGEST_CONFIRMED'",
      "ipcMain.handle('PARAKEET_EOU_FINISH'",
    );

    expect(handler).toContain(
      'captureSessionLease.requireRecordingOwner(meetingId, event.sender.id)',
    );
    expect(handler).not.toContain('requireParakeetEouOwner');
    expect(handler).toContain('meetingContextProducer.ingest(request)');
  });

  it('drains queued context production before deleting its meeting', () => {
    const handler = sliceBetween(
      main,
      "ipcMain.handle('DELETE_MEETING'",
      "ipcMain.handle('GENERATE_TITLE'",
    );

    expect(handler).toContain('await meetingContextProducer.cancel(meetingId)');
    expect(handler.indexOf('meetingContextProducer.cancel')).toBeLessThan(
      handler.indexOf('db.deleteMeeting'),
    );
  });
});
