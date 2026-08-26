import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-search-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  getMeetingFtsIntegrity,
  getTemporalMeetings,
  repairMeetingFtsIndex,
  saveMeeting,
  searchMeetingsFts,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('meeting search index integrity', () => {
  it('keeps exactly one FTS document across repeated meeting refreshes', () => {
    for (let index = 0; index < 10; index += 1) {
      saveMeeting({
        id: 'today-1',
        title: 'Pricing review',
        started_at: '2026-08-25T17:00:00.000Z',
        transcript_json: JSON.stringify({
          segments: [{ text: `Pricing decision revision ${index}` }],
        }),
      });
    }

    expect(getMeetingFtsIntegrity()).toEqual({
      rowCount: 1,
      distinctMeetingCount: 1,
      duplicateRowCount: 0,
    });
    expect(searchMeetingsFts('"Pricing"')).toHaveLength(1);
  });

  it('repairs legacy duplicate documents from canonical meetings', () => {
    saveMeeting({ id: 'today-2', title: 'Launch review' });
    repairMeetingFtsIndex({ force: true });

    expect(getMeetingFtsIntegrity()).toEqual({
      rowCount: 2,
      distinctMeetingCount: 2,
      duplicateRowCount: 0,
    });
  });

  it('uses a half-open temporal range and returns complete meeting rows', () => {
    saveMeeting({
      id: 'tomorrow-boundary',
      title: 'Tomorrow',
      started_at: '2026-08-26T07:00:00.000Z',
    });

    const meetings = getTemporalMeetings({
      from: '2026-08-25T07:00:00.000Z',
      to: '2026-08-26T07:00:00.000Z',
    });

    expect(meetings.map((meeting) => meeting.id)).toContain('today-1');
    expect(meetings.map((meeting) => meeting.id)).not.toContain(
      'tomorrow-boundary',
    );
    expect(meetings.find((meeting) => meeting.id === 'today-1')?.title).toBe(
      'Pricing review',
    );
  });
});
