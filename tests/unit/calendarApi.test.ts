import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  confirmRecordingCalendarEvent,
  connectCalendar,
  disconnectCalendar,
  getCalendarState,
  listActiveCalendarCandidates,
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

  it('lists candidates and submits only an explicit recording choice', async () => {
    await matchActiveCalendarEvent('2026-09-04T17:30:00.000Z');
    expect(invoke).toHaveBeenCalledWith('CALENDAR_MATCH_ACTIVE', {
      atTime: '2026-09-04T17:30:00.000Z',
    });

    await listActiveCalendarCandidates('2026-09-04T17:30:00.000Z');
    expect(invoke).toHaveBeenCalledWith('CALENDAR_LIST_ACTIVE_CANDIDATES', {
      atTime: '2026-09-04T17:30:00.000Z',
    });

    await confirmRecordingCalendarEvent('meeting-1', 'invite-a');
    expect(invoke).toHaveBeenCalledWith('CALENDAR_CONFIRM_RECORDING', {
      meetingId: 'meeting-1',
      occurrenceKey: 'invite-a',
    });
  });
});
