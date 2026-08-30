import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectCalendar,
  disconnectCalendar,
  getCalendarState,
  listCalendarDay,
  selectCalendar,
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
});
