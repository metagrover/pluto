// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../electron/calendar/types';
import { UpcomingMeetings } from '../../src/components/features/UpcomingMeetings';

const workCalendar = {
  identifier: 'calendar-a',
  title: 'Work',
  sourceTitle: 'iCloud',
  sourceType: 'icloud',
  colorHex: '#7367D9',
};

const personalCalendar = {
  identifier: 'calendar-b',
  title: 'Personal',
  sourceTitle: 'Google',
  sourceType: 'caldav',
  colorHex: '#34A853',
};

const meetingTitles = [
  'Product review',
  'Go-to-market planning',
  'Leadership check-in',
  'Design critique',
  'Customer interview',
  'Weekly retrospective',
];

const snapshot = (
  overrides: Partial<CalendarIntegrationSnapshot> = {},
): CalendarIntegrationSnapshot => {
  const selectedCalendar =
    'selectedCalendar' in overrides
      ? (overrides.selectedCalendar ?? null)
      : workCalendar;
  const selectedCalendars =
    overrides.selectedCalendars ?? (selectedCalendar ? [selectedCalendar] : []);
  return {
    state: 'ready',
    authorization: 'full_access',
    enabled: true,
    selectedCalendar,
    selectedCalendars,
    calendars: [],
    lastAttemptAt: '2026-08-30T16:00:00.000Z',
    lastReadAt: '2026-08-30T16:00:00.000Z',
    cacheStart: '2026-08-16T16:00:00.000Z',
    cacheEnd: '2026-09-29T16:00:00.000Z',
    stale: false,
    ...overrides,
  };
};

const meeting = (index: number): CalendarEvent => ({
  occurrenceKey: `event-${index}`,
  eventIdentifier: `event-${index}`,
  calendarIdentifier: 'calendar-a',
  title: meetingTitles[index] ?? `Meeting ${index + 1}`,
  start: `2026-08-30T${String(17 + index).padStart(2, '0')}:30:00.000Z`,
  end: `2026-08-30T${String(18 + index).padStart(2, '0')}:30:00.000Z`,
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
});

const installMatchMedia = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = '(min-width: 1024px)';
  const query = {
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
};

const render = (
  props: Partial<React.ComponentProps<typeof UpcomingMeetings>> = {},
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <UpcomingMeetings
        snapshot={snapshot()}
        events={[meeting(0), meeting(1), meeting(2)]}
        loading={false}
        onConnect={vi.fn(async () => {})}
        onSelectCalendar={vi.fn(async () => {})}
        onRefreshCalendar={vi.fn(async () => {})}
        onOpenSettings={vi.fn()}
        {...props}
      />,
    ),
  );
  return { container, root };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UpcomingMeetings', () => {
  it('formats durations in minutes below an hour and hours with remaining minutes', () => {
    const durations = [30, 60, 115, 120, 500];
    const events = durations.map((minutes, index) => ({
      ...meeting(index),
      start: '2026-09-25T12:00:00.000Z',
      end: new Date(
        Date.parse('2026-09-25T12:00:00.000Z') + minutes * 60_000,
      ).toISOString(),
    }));
    const agenda = render({ events });
    const more = agenda.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show 2 more meetings"]',
    );
    act(() => more?.click());
    const rows = agenda.container.querySelectorAll(
      '[data-testid="upcoming-meeting-row"]',
    );
    expect(
      Array.from(rows, (row) => row.querySelector('p')?.textContent),
    ).toEqual([
      '30 minutes',
      '1 hour',
      '1 hr 55 mins',
      '2 hours',
      '8 hrs 20 mins',
    ]);
    act(() => agenda.root.unmount());
  });

  it('shows three compact rows and five large-layout rows before disclosure', async () => {
    const media = installMatchMedia(false);
    const { container, root } = render({
      events: Array.from({ length: 6 }, (_, index) => meeting(index)),
    });
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(3);
    expect(container.textContent).toContain('Leadership check-in');
    expect(container.textContent).not.toContain('Design critique');
    expect(
      container.querySelector('button[aria-label="Show 3 more meetings"]'),
    ).not.toBeNull();

    await act(async () => media.setMatches(true));
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(5);
    expect(container.textContent).toContain('Customer interview');
    expect(container.textContent).not.toContain('Weekly retrospective');

    const more = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show 1 more meeting"]',
    );
    expect(more?.textContent).toContain('More');
    expect(container.querySelector('.border-b')).toBeNull();

    await act(async () => more?.click());
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(6);
    expect(container.textContent).toContain('Weekly retrospective');
    expect(container.textContent).toContain('Show less');

    const less = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show fewer meetings"]',
    );
    await act(async () => less?.click());
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(5);
    act(() => root.unmount());
  });

  it('uses one calm agenda hierarchy with subordinate calendar metadata', () => {
    const longCalendar = {
      ...workCalendar,
      title: 'Plans with Pookie and the extended family calendar',
    };
    const onOpenSettings = vi.fn();
    const agenda = render({
      snapshot: snapshot({ selectedCalendar: longCalendar }),
      onOpenSettings,
    });

    const heading = agenda.container.querySelector('#upcoming-meetings-title');
    expect(heading?.className).toContain('whitespace-nowrap');
    expect(heading?.parentElement?.textContent).toBe(
      'Your dayUpcoming meetings',
    );
    expect(agenda.container.querySelector('.divide-y')).toBeNull();

    const source = agenda.container.querySelector(
      '[data-testid="upcoming-meetings-source"]',
    );
    expect(source?.textContent).toContain(longCalendar.title);
    expect(source?.textContent).toContain('iCloud');
    expect(source?.querySelector('.truncate')).not.toBeNull();
    source
      ?.querySelector<HTMLButtonElement>('button[aria-label="Change calendar"]')
      ?.click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    act(() => agenda.root.unmount());
  });

  it('uses the compact footprint for first-run and denied states', async () => {
    const onConnect = vi.fn(async () => {});
    const first = render({
      snapshot: snapshot({
        state: 'not_determined',
        authorization: 'not_determined',
        enabled: false,
        selectedCalendar: null,
      }),
      events: [],
      onConnect,
    });
    expect(first.container.textContent).toContain('See what’s next');
    const connectButton = first.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Connect Calendar"]',
    );
    expect(connectButton?.className).toContain('text-pro-text-muted');
    expect(connectButton?.className).toContain('rounded-md');
    expect(connectButton?.className).toContain('border-pro-border');
    expect(connectButton?.className).toContain('bg-pro-surface');
    expect(connectButton?.className).not.toContain('bg-pro-accent');
    expect(first.container.querySelector('.border-b')).toBeNull();
    await act(async () => connectButton?.click());
    expect(onConnect).toHaveBeenCalledOnce();
    act(() => first.root.unmount());

    const onOpenSettings = vi.fn();
    const denied = render({
      snapshot: snapshot({
        state: 'denied',
        authorization: 'denied',
        enabled: false,
        selectedCalendar: null,
      }),
      events: [],
      onOpenSettings,
    });
    expect(denied.container.textContent).toContain('Calendar access is off');
    expect(denied.container.querySelector('.border-b')).toBeNull();
    denied.container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open Calendar settings"]',
      )
      ?.click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    act(() => denied.root.unmount());
  });

  it('supports single-line dropdown trigger and instant multi-select popover', async () => {
    const onSelectCalendars = vi.fn(async () => {});
    const picker = render({
      snapshot: snapshot({
        state: 'needs_selection',
        enabled: false,
        selectedCalendar: null,
        selectedCalendars: [],
        calendars: [workCalendar, personalCalendar],
      }),
      events: [],
      onSelectCalendars,
    });

    // 1. Initially collapsed to a single line: no bulky instructions or open menu
    const trigger = picker.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose calendars"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.parentElement?.className).toBe('relative');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(picker.container.textContent).not.toContain(
      'Pluto will read meetings from selected calendars.',
    );
    expect(picker.container.querySelector('[role="menu"]')).toBeNull();

    // 2. Click trigger to open popover
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const menu = picker.container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();

    const checkboxes = Array.from(
      menu!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);

    // 3. Instant toggle: checking the first calendar immediately commits it
    await act(async () => checkboxes[0].click());
    expect(onSelectCalendars).toHaveBeenCalledWith([workCalendar]);

    // 4. Checking second calendar immediately commits both
    await act(async () => checkboxes[1].click());
    expect(onSelectCalendars).toHaveBeenCalledWith([
      workCalendar,
      personalCalendar,
    ]);

    // 5. Dismiss on Escape
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(picker.container.querySelector('[role="menu"]')).toBeNull();

    // 6. Re-open and test outside click dismissal
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }),
      );
    });
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(picker.container.querySelector('[role="menu"]')).toBeNull();

    act(() => picker.root.unmount());
  });

  it('guards against unchecking the last remaining calendar and handles selection errors', async () => {
    const onSelectCalendars = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Network error'));

    const picker = render({
      snapshot: snapshot({
        state: 'needs_selection',
        enabled: false,
        selectedCalendar: null,
        selectedCalendars: [],
        calendars: [workCalendar],
      }),
      events: [],
      onSelectCalendars,
    });

    const trigger = picker.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose calendars"]',
    );
    await act(async () => trigger?.click());

    const menu = picker.container.querySelector('[role="menu"]');
    const checkbox = menu!.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );

    // 1. Check the only calendar -> commits
    await act(async () => checkbox?.click());
    expect(onSelectCalendars).toHaveBeenCalledTimes(1);

    // 2. Click again: guard prevents deselecting the only remaining calendar
    await act(async () => checkbox?.click());
    expect(onSelectCalendars).toHaveBeenCalledTimes(1);

    act(() => picker.root.unmount());
  });

  it('displays "Choose another calendar" when selected calendar is missing', () => {
    const picker = render({
      snapshot: snapshot({
        state: 'selected_calendar_missing',
        enabled: false,
        selectedCalendar: null,
        selectedCalendars: [],
        calendars: [workCalendar],
      }),
      events: [],
    });

    const trigger = picker.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose another calendar"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('Choose another calendar');
    act(() => picker.root.unmount());
  });

  it('summarizes multiple connected calendars quietly in the footer', () => {
    const onOpenSettings = vi.fn();
    const agenda = render({
      snapshot: snapshot({
        selectedCalendar: workCalendar,
        selectedCalendars: [workCalendar, personalCalendar],
      }),
      onOpenSettings,
    });

    const source = agenda.container.querySelector(
      '[data-testid="upcoming-meetings-source"]',
    );
    expect(source?.textContent).toContain('2 calendars');
    expect(source?.textContent).not.toContain('Work · iCloud');
    expect(source?.querySelector('[title]')?.getAttribute('title')).toContain(
      'Work',
    );
    expect(source?.querySelector('[title]')?.getAttribute('title')).toContain(
      'Personal',
    );

    source
      ?.querySelector<HTMLButtonElement>('button[aria-label="Change calendar"]')
      ?.click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    act(() => agenda.root.unmount());
  });

  it('handles clear-day, loading, and stale-cache states truthfully', () => {
    const clear = render({ events: [] });
    expect(clear.container.textContent).toContain('No meetings today');
    act(() => clear.root.unmount());

    const loading = render({ snapshot: null, events: [], loading: true });
    expect(
      loading.container.querySelector('section')?.getAttribute('aria-busy'),
    ).toBe('true');
    act(() => loading.root.unmount());

    const stale = render({
      snapshot: snapshot({ state: 'read_failed', stale: true }),
      events: [meeting(0)],
    });
    expect(stale.container.textContent).toContain('Last read');
    expect(stale.container.textContent).toContain('Product review');
    act(() => stale.root.unmount());
  });

  it('keeps the empty-today message above meetings on future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const agenda = render({
      events: [
        {
          ...meeting(0),
          title: 'Tomorrow planning',
          start: '2026-08-31T09:00:00.000Z',
          end: '2026-08-31T09:30:00.000Z',
        },
        {
          ...meeting(1),
          title: 'September review',
          start: '2026-09-10T15:00:00.000Z',
          end: '2026-09-10T15:30:00.000Z',
        },
      ],
    });

    expect(agenda.container.textContent).toContain('No meetings today');
    expect(agenda.container.textContent).toContain('Tomorrow planning');
    expect(agenda.container.textContent).toContain('September review');
    const futureDates = agenda.container.querySelectorAll(
      '[data-testid="upcoming-meeting-date"]',
    );
    expect(futureDates).toHaveLength(2);
    expect(futureDates[0].textContent).toBe('Tomorrow');
    expect(futureDates[1].textContent).toBeTruthy();
    act(() => agenda.root.unmount());
  });

  it('names the selected calendar when a fresh read fails', () => {
    const onRefreshCalendar = vi.fn(async () => {});
    const failed = render({
      snapshot: snapshot({
        state: 'read_failed',
        stale: false,
        lastReadAt: null,
      }),
      events: [],
      onRefreshCalendar,
    });

    expect(failed.container.textContent).toContain('Couldn’t refresh Work');
    failed.container
      .querySelector<HTMLButtonElement>('button[aria-label="Try again"]')
      ?.click();
    expect(onRefreshCalendar).toHaveBeenCalledOnce();
    act(() => failed.root.unmount());
  });
});
