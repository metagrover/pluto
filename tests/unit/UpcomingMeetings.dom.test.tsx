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

const snapshot = (
  overrides: Partial<CalendarIntegrationSnapshot> = {},
): CalendarIntegrationSnapshot => ({
  state: 'ready',
  authorization: 'full_access',
  enabled: true,
  selectedCalendar: workCalendar,
  calendars: [],
  lastAttemptAt: '2026-08-30T16:00:00.000Z',
  lastReadAt: '2026-08-30T16:00:00.000Z',
  cacheStart: '2026-08-16T16:00:00.000Z',
  cacheEnd: '2026-09-29T16:00:00.000Z',
  stale: false,
  ...overrides,
});

const meeting = (index: number): CalendarEvent => ({
  occurrenceKey: `event-${index}`,
  eventIdentifier: `event-${index}`,
  calendarIdentifier: 'calendar-a',
  title: ['Product review', 'Go-to-market planning', 'Leadership check-in'][
    index
  ],
  start: `2026-08-30T${String(17 + index).padStart(2, '0')}:30:00.000Z`,
  end: `2026-08-30T${String(18 + index).padStart(2, '0')}:30:00.000Z`,
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
});

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
});

describe('UpcomingMeetings', () => {
  it('shows exactly two rows before an inline See more disclosure', async () => {
    const { container, root } = render();
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain('Leadership check-in');
    const more = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show 1 more meeting"]',
    );
    expect(more?.textContent).toContain('See more');
    expect(container.querySelector('.border-b')).toBeNull();

    await act(async () => more?.click());
    expect(
      container.querySelectorAll('[data-testid="upcoming-meeting-row"]'),
    ).toHaveLength(3);
    expect(container.textContent).toContain('Leadership check-in');
    expect(container.textContent).toContain('Show less');
    act(() => root.unmount());
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

  it('lets the dashboard choose a calendar in place', async () => {
    const onSelectCalendar = vi.fn(async () => {});
    const picker = render({
      snapshot: snapshot({
        state: 'needs_selection',
        enabled: false,
        selectedCalendar: null,
        calendars: [workCalendar],
      }),
      events: [],
      onSelectCalendar,
    });

    expect(picker.container.textContent).toContain('Choose one calendar');
    await act(async () =>
      picker.container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Use Work calendar from iCloud"]',
        )
        ?.click(),
    );
    expect(onSelectCalendar).toHaveBeenCalledWith(workCalendar);
    act(() => picker.root.unmount());
  });

  it('handles clear-day, loading, and stale-cache states truthfully', () => {
    const clear = render({ events: [] });
    expect(clear.container.textContent).toContain('No more meetings today');
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
});
