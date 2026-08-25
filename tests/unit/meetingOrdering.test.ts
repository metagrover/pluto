import { describe, expect, it } from 'vitest';
import { sortMeetingsByStartTime } from '../../src/utils/meetingOrdering';

describe('sortMeetingsByStartTime', () => {
  it('orders meetings by when recording started even when created_at is newer', () => {
    const meetings = [
      {
        id: 'recovered',
        created_at: '2026-08-25T08:31:00.000Z',
        started_at: '2026-08-25T08:29:00.000Z',
      },
      {
        id: 'latest-recording',
        created_at: '2026-08-25T08:10:00.000Z',
        started_at: '2026-08-25T16:49:00.000Z',
      },
    ];

    expect(
      sortMeetingsByStartTime(meetings).map((meeting) => meeting.id),
    ).toEqual(['latest-recording', 'recovered']);
  });
});
