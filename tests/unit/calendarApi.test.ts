import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  associateMeetingAtStart,
  connectCalendar,
  disconnectCalendar,
  getCalendarState,
  listCalendarDay,
  matchActiveCalendarEvent,
  selectCalendar,
  selectCalendars,
} from '../../src/api/calendar';

describe('calendar renderer API', () => {
  const invoke = vi.fn(async () => ({}));
  beforeEach(() => {
    invoke.mockClear();
    Object.assign(globalThis, {
      window: { ipcRenderer: { invoke } },
    });
  });

  it('uses fixed channels and shaped arguments', async () => {
    await getCalendarState();
    await connectCalendar();
    await selectCalendar({
      identifier: 'calendar-a',
      title: 'Work',
      sourceTitle: 'iCloud',
      sourceType: 'icloud',
      colorHex: null,
    });
    await listCalendarDay(
      '2026-08-30T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z',
    );
    await disconnectCalendar();

    expect(invoke.mock.calls).toEqual([
      ['CALENDAR_GET_STATE'],
      ['CALENDAR_CONNECT'],
      [
        'CALENDAR_SELECT',
        expect.objectContaining({ identifier: 'calendar-a' }),
      ],
      [
        'CALENDAR_LIST_DAY',
        {
          start: '2026-08-30T00:00:00.000Z',
          end: '2026-08-31T00:00:00.000Z',
        },
      ],
      ['CALENDAR_DISCONNECT'],
    ]);
  });

  it('selectCalendars sends array to CALENDAR_SELECT', async () => {
    const calendar = {
      identifier: 'calendar-a',
      title: 'Work',
      sourceTitle: 'iCloud',
      sourceType: 'icloud',
      colorHex: null,
    };
    await selectCalendars([calendar]);
    expect(invoke).toHaveBeenCalledWith('CALENDAR_SELECT', [calendar]);
  });

  it('invokes CALENDAR_MATCH_ACTIVE and CALENDAR_ASSOCIATE_START', async () => {
    await matchActiveCalendarEvent('2026-09-04T17:30:00.000Z');
    expect(invoke).toHaveBeenCalledWith('CALENDAR_MATCH_ACTIVE', {
      atTime: '2026-09-04T17:30:00.000Z',
    });

    await associateMeetingAtStart('meeting-1', '2026-09-04T17:30:00.000Z');
    expect(invoke).toHaveBeenCalledWith('CALENDAR_ASSOCIATE_START', {
      meetingId: 'meeting-1',
      atTime: '2026-09-04T17:30:00.000Z',
    });
  });
});
