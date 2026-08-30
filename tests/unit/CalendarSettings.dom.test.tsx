// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CalendarIntegrationSnapshot } from '../../electron/calendar/types';
import { CalendarSettings } from '../../src/components/features/CalendarSettings';

const api = vi.hoisted(() => ({
  connectCalendar: vi.fn(),
  selectCalendar: vi.fn(),
  refreshCalendar: vi.fn(),
  disconnectCalendar: vi.fn(),
  openCalendarSystemSettings: vi.fn(),
}));

vi.mock('../../src/api/calendar', () => api);

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
  state: 'not_determined',
  authorization: 'not_determined',
  enabled: false,
  selectedCalendar: null,
  calendars: [],
  lastAttemptAt: null,
  lastReadAt: null,
  cacheStart: null,
  cacheEnd: null,
  stale: false,
  ...overrides,
});

const render = (value: CalendarIntegrationSnapshot) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSnapshotChange = vi.fn();
  act(() =>
    root.render(
      <CalendarSettings snapshot={value} onSnapshotChange={onSnapshotChange} />,
    ),
  );
  return { container, root, onSnapshotChange };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('CalendarSettings', () => {
  it('explains the native full-access boundary before connecting', () => {
    const { container, root } = render(snapshot());
    expect(container.textContent).toContain('Calendar context');
    expect(container.textContent).toContain(
      'macOS grants full Calendar access',
    );
    expect(container.textContent).toContain('Pluto only reads events');
    expect(container.textContent).toContain('No account or hosted service');
    act(() => root.unmount());
  });

  it('lets the user choose exactly one calendar', async () => {
    const selected = snapshot({
      state: 'ready',
      authorization: 'full_access',
      enabled: true,
      selectedCalendar: workCalendar,
      calendars: [workCalendar],
    });
    api.selectCalendar.mockResolvedValue(selected);
    const { container, root, onSnapshotChange } = render(
      snapshot({
        state: 'needs_selection',
        authorization: 'full_access',
        calendars: [workCalendar],
      }),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Use Work calendar from iCloud"]',
        )
        ?.click(),
    );
    expect(api.selectCalendar).toHaveBeenCalledWith(workCalendar);
    expect(onSnapshotChange).toHaveBeenCalledWith(selected);
    act(() => root.unmount());
  });

  it('shows active maintenance and denial recovery actions', async () => {
    const ready = render(
      snapshot({
        state: 'ready',
        authorization: 'full_access',
        enabled: true,
        selectedCalendar: workCalendar,
        calendars: [workCalendar],
        lastReadAt: '2026-08-30T16:00:00.000Z',
      }),
    );
    expect(ready.container.textContent).toContain('Work');
    expect(ready.container.textContent).toContain('Last read from this Mac');
    expect(ready.container.textContent).toContain('Refresh');
    expect(ready.container.textContent).toContain('Disconnect');
    act(() => ready.root.unmount());

    const denied = render(
      snapshot({ state: 'denied', authorization: 'denied' }),
    );
    denied.container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open Calendar privacy settings"]',
      )
      ?.click();
    expect(api.openCalendarSystemSettings).toHaveBeenCalledWith('privacy');
    expect(denied.container.textContent).toContain('Recording still works');
    act(() => denied.root.unmount());
  });
});
