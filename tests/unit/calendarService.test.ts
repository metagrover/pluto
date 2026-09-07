import { describe, expect, it, vi } from 'vitest';

import { createCalendarService } from '../../electron/calendar/service';
import type {
  CalendarAuthorizationStatus,
  CalendarDescriptor,
  CalendarEvent,
} from '../../electron/calendar/types';

const calendar: CalendarDescriptor = {
  identifier: 'calendar-a',
  title: 'Work',
  sourceTitle: 'iCloud',
  sourceType: 'icloud',
  colorHex: '#7367D9',
};

const event: CalendarEvent = {
  occurrenceKey: 'event-a',
  eventIdentifier: 'event-a',
  calendarIdentifier: 'calendar-a',
  title: 'Product review',
  start: '2026-08-30T17:30:00.000Z',
  end: '2026-08-30T18:30:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
};

const calendarB: CalendarDescriptor = {
  identifier: 'calendar-b',
  title: 'Personal',
  sourceTitle: 'Google',
  sourceType: 'caldav',
  colorHex: '#34A853',
};

const eventB: CalendarEvent = {
  occurrenceKey: 'event-b',
  eventIdentifier: 'event-b',
  calendarIdentifier: 'calendar-b',
  title: 'Family dinner',
  start: '2026-08-30T19:00:00.000Z',
  end: '2026-08-30T20:00:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
};

const createFixture = (
  options: {
    platform?: NodeJS.Platform;
    runtimeAvailable?: boolean;
    authorization?: CalendarAuthorizationStatus;
    calendars?: CalendarDescriptor[];
    events?: CalendarEvent[];
  } = {},
) => {
  let authorization = options.authorization ?? 'not_determined';
  let state = {
    enabled: false,
    selectedCalendar: null as CalendarDescriptor | null,
    selectedCalendars: [] as CalendarDescriptor[],
    cacheRevision: 0,
    lastAttemptAt: null as string | null,
    lastReadAt: null as string | null,
    cacheStart: null as string | null,
    cacheEnd: null as string | null,
    errorCode: null,
  };
  const store = {
    getState: vi.fn(() => state),
    selectCalendar: vi.fn((selected: CalendarDescriptor) => {
      state = {
        ...state,
        enabled: true,
        selectedCalendar: selected,
        selectedCalendars: [selected],
      };
      return state;
    }),
    selectCalendars: vi.fn((selected: CalendarDescriptor[]) => {
      state = {
        ...state,
        enabled: selected.length > 0,
        selectedCalendar: selected[0] ?? null,
        selectedCalendars: selected,
      };
      return state;
    }),
    replaceEvents: vi.fn(
      (input: {
        revision: number;
        readAt: string;
        events: CalendarEvent[];
      }) => {
        state = {
          ...state,
          cacheRevision: input.revision,
          lastAttemptAt: input.readAt,
          lastReadAt: input.readAt,
        };
        return true;
      },
    ),
    listEvents: vi.fn(() => options.events ?? [event]),
    recordFailure: vi.fn((errorCode: 'read_failed', readAt: string) => {
      state = { ...state, errorCode, lastAttemptAt: readAt };
    }),
    disconnect: vi.fn(() => {
      state = {
        ...state,
        enabled: false,
        selectedCalendar: null,
        selectedCalendars: [],
      };
    }),
  };
  const client = {
    authorizationStatus: vi.fn(async () => authorization),
    requestAccess: vi.fn(async () => {
      authorization = options.authorization ?? 'full_access';
      return authorization;
    }),
    listCalendars: vi.fn(async () => options.calendars ?? [calendar]),
    listEvents: vi.fn(async (calId: string) => {
      if (calId === 'calendar-b') return [eventB];
      return options.events ?? [event];
    }),
    onChange: vi.fn(() => () => {}),
    close: vi.fn(),
  };
  return {
    store,
    client,
    service: createCalendarService({
      platform: options.platform ?? 'darwin',
      runtimeAvailable: () => options.runtimeAvailable ?? true,
      client,
      store: store as never,
      now: () => new Date('2026-08-30T16:00:00.000Z'),
    }),
  };
};

describe('calendar service', () => {
  it('reports unsupported platforms and missing runtimes without prompting', async () => {
    const unsupported = createFixture({ platform: 'win32' });
    await expect(unsupported.service.getSnapshot()).resolves.toMatchObject({
      state: 'unsupported_platform',
    });
    expect(unsupported.client.authorizationStatus).not.toHaveBeenCalled();

    const missing = createFixture({ runtimeAvailable: false });
    await expect(missing.service.getSnapshot()).resolves.toMatchObject({
      state: 'runtime_missing',
    });
  });

  it('requests access only from connect and returns calendars for selection', async () => {
    const fixture = createFixture({ authorization: 'full_access' });
    await expect(fixture.service.connect()).resolves.toMatchObject({
      state: 'needs_selection',
      calendars: [calendar],
    });
    expect(fixture.client.requestAccess).toHaveBeenCalledOnce();
  });

  it('refreshes a selected calendar with the bounded rolling window', async () => {
    const fixture = createFixture({ authorization: 'full_access' });
    await fixture.service.selectCalendar(calendar);

    expect(fixture.client.listEvents).toHaveBeenCalledWith(
      'calendar-a',
      '2026-08-16T16:00:00.000Z',
      '2026-09-29T16:00:00.000Z',
    );
    expect(fixture.store.replaceEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarIdentifier: 'calendar-a',
        revision: 1,
        events: [event],
      }),
    );
  });

  it('keeps a chosen calendar when its first refresh fails', async () => {
    const fixture = createFixture({ authorization: 'full_access' });
    fixture.client.listEvents.mockRejectedValueOnce(new Error('native failed'));

    await expect(
      fixture.service.selectCalendar(calendar),
    ).resolves.toMatchObject({
      state: 'read_failed',
      enabled: true,
      selectedCalendar: calendar,
    });
  });

  it('preserves the cache and records a finite failure when a read fails', async () => {
    const fixture = createFixture({ authorization: 'full_access' });
    fixture.store.selectCalendar(calendar);
    fixture.client.listEvents.mockRejectedValueOnce(new Error('native failed'));

    await expect(fixture.service.refresh()).rejects.toThrow('native failed');
    expect(fixture.store.replaceEvents).not.toHaveBeenCalled();
    expect(fixture.store.recordFailure).toHaveBeenCalledWith(
      'read_failed',
      '2026-08-30T16:00:00.000Z',
    );
  });

  it('disconnects and invalidates a refresh that finishes later', async () => {
    const fixture = createFixture({ authorization: 'full_access' });
    fixture.store.selectCalendar(calendar);
    let resolveEvents!: (events: CalendarEvent[]) => void;
    fixture.client.listEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEvents = resolve;
        }),
    );

    const refresh = fixture.service.refresh();
    fixture.service.disconnect();
    resolveEvents([event]);
    await refresh;

    expect(fixture.store.replaceEvents).not.toHaveBeenCalled();
    expect(fixture.store.disconnect).toHaveBeenCalledOnce();
    expect(fixture.client.close).toHaveBeenCalledOnce();
  });

  it('restores native change observation when reconnecting after disconnect', async () => {
    const fixture = createFixture();
    fixture.service.start();
    fixture.service.disconnect();

    await fixture.service.connect();

    expect(fixture.client.onChange).toHaveBeenCalledTimes(2);
  });

  it('selects multiple calendars and refreshes events across all selected calendars', async () => {
    const fixture = createFixture({
      authorization: 'full_access',
      calendars: [calendar, calendarB],
    });

    const snapshot = await fixture.service.selectCalendars([
      calendar,
      calendarB,
    ]);
    expect(snapshot.state).toBe('ready');
    expect(snapshot.selectedCalendars).toEqual([calendar, calendarB]);
    expect(snapshot.selectedCalendar).toEqual(calendar);

    expect(fixture.client.listEvents).toHaveBeenCalledWith(
      'calendar-a',
      '2026-08-16T16:00:00.000Z',
      '2026-09-29T16:00:00.000Z',
    );
    expect(fixture.client.listEvents).toHaveBeenCalledWith(
      'calendar-b',
      '2026-08-16T16:00:00.000Z',
      '2026-09-29T16:00:00.000Z',
    );
    expect(fixture.store.replaceEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        events: [event, eventB],
      }),
    );
  });

  it('preserves the prior combined cache when one of multiple calendar reads fails', async () => {
    const fixture = createFixture({
      authorization: 'full_access',
      calendars: [calendar, calendarB],
    });
    fixture.store.selectCalendars([calendar, calendarB]);
    fixture.client.listEvents.mockImplementation(async (calId: string) => {
      if (calId === 'calendar-b') throw new Error('CalDAV timeout');
      return [event];
    });

    await expect(fixture.service.refresh()).rejects.toThrow('CalDAV timeout');
    expect(fixture.store.replaceEvents).not.toHaveBeenCalled();
    expect(fixture.store.recordFailure).toHaveBeenCalledWith(
      'read_failed',
      '2026-08-30T16:00:00.000Z',
    );
  });

  it('lists a bounded 30-day dashboard agenda from the cached events', () => {
    const fixture = createFixture({
      authorization: 'full_access',
      events: [event, eventB],
    });
    const start = '2026-08-30T00:00:00.000Z';
    const end = '2026-09-29T00:00:00.000Z';

    expect(fixture.service.listDay(start, end)).toEqual([event, eventB]);
    expect(fixture.store.listEvents).toHaveBeenCalledWith(start, end);
  });

  it('rejects calendar agenda ranges longer than 32 days', () => {
    const fixture = createFixture({ authorization: 'full_access' });

    expect(() =>
      fixture.service.listDay(
        '2026-08-30T00:00:00.000Z',
        '2026-10-02T00:00:01.000Z',
      ),
    ).toThrow('invalid_calendar_day');
  });

  it('reports selected_calendar_missing when any selected calendar disappears', async () => {
    const fixture = createFixture({
      authorization: 'full_access',
      calendars: [calendar], // calendarB is missing!
    });
    fixture.store.selectCalendars([calendar, calendarB]);

    const snapshot = await fixture.service.getSnapshot();
    expect(snapshot.state).toBe('selected_calendar_missing');
    // Selections must not be silently modified
    expect(snapshot.selectedCalendars).toEqual([calendar, calendarB]);
  });
});
