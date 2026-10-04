// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CalendarIntegrationSnapshot } from '../../electron/calendar/types';
import { CalendarSettings } from '../../src/components/features/CalendarSettings';

const api = vi.hoisted(() => ({
  connectCalendar: vi.fn(),
  selectCalendar: vi.fn(),
  selectCalendars: vi.fn(),
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

const personalCalendar = {
  identifier: 'calendar-b',
  title: 'Personal',
  sourceTitle: 'Google',
  sourceType: 'caldav',
  colorHex: '#34A853',
};

const snapshot = (
  overrides: Partial<CalendarIntegrationSnapshot> = {},
): CalendarIntegrationSnapshot => {
  const selectedCalendar =
    'selectedCalendar' in overrides
      ? (overrides.selectedCalendar ?? null)
      : null;
  const selectedCalendars =
    overrides.selectedCalendars ?? (selectedCalendar ? [selectedCalendar] : []);
  return {
    state: 'not_determined',
    authorization: 'not_determined',
    enabled: false,
    selectedCalendar,
    selectedCalendars,
    calendars: [],
    lastAttemptAt: null,
    lastReadAt: null,
    cacheStart: null,
    cacheEnd: null,
    stale: false,
    ...overrides,
  };
};

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
  it('explains when a Calendar permission request leaves access undecided', async () => {
    api.connectCalendar.mockResolvedValue(snapshot());
    const { container, root } = render(snapshot());

    const connect = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Connect Calendar'),
    );
    await act(async () => connect?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'macOS did not show a Calendar access prompt',
    );
    const openSettings = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Open Calendar settings'),
    );
    await act(async () => openSettings?.click());
    expect(api.openCalendarSystemSettings).toHaveBeenCalledWith('privacy');
    act(() => root.unmount());
  });

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

  it('provides grouped multi-selection with staged changes and Save changes', async () => {
    const selected = snapshot({
      state: 'ready',
      authorization: 'full_access',
      enabled: true,
      selectedCalendar: workCalendar,
      selectedCalendars: [workCalendar, personalCalendar],
      calendars: [workCalendar, personalCalendar],
    });
    api.selectCalendars.mockResolvedValue(selected);

    const { container, root, onSnapshotChange } = render(
      snapshot({
        state: 'needs_selection',
        authorization: 'full_access',
        calendars: [workCalendar, personalCalendar],
      }),
    );

    // Grouping by sourceTitle
    expect(container.textContent).toContain('iCloud');
    expect(container.textContent).toContain('Google');

    const saveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Save changes"]',
    );
    // Disabled when no calendars are selected
    expect(saveButton?.disabled).toBe(true);

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);

    // Check both
    await act(async () => checkboxes[0].click());
    expect(saveButton?.disabled).toBe(false);

    await act(async () => checkboxes[1].click());
    await act(async () => saveButton?.click());

    expect(api.selectCalendars).toHaveBeenCalledWith([
      workCalendar,
      personalCalendar,
    ]);
    expect(onSnapshotChange).toHaveBeenCalledWith(selected);
    act(() => root.unmount());
  });

  it('shows missing selected calendar requiring explicit user resolution', async () => {
    const resolved = snapshot({
      state: 'ready',
      authorization: 'full_access',
      enabled: true,
      selectedCalendar: workCalendar,
      selectedCalendars: [workCalendar],
      calendars: [workCalendar],
    });
    api.selectCalendars.mockResolvedValue(resolved);

    const { container, root, onSnapshotChange } = render(
      snapshot({
        state: 'selected_calendar_missing',
        authorization: 'full_access',
        enabled: true,
        selectedCalendar: workCalendar,
        selectedCalendars: [workCalendar, personalCalendar],
        calendars: [workCalendar], // personalCalendar is missing from available
      }),
    );

    expect(container.textContent).toContain('Personal');
    expect(container.textContent).toContain('Missing');

    // Staged save button is disabled until user changes selection
    const saveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Save changes"]',
    );
    expect(saveButton?.disabled).toBe(true);

    // Uncheck the missing calendar
    const missingCheckbox = container.querySelector<HTMLInputElement>(
      'input[aria-label*="Personal"]',
    );
    await act(async () => missingCheckbox?.click());

    expect(saveButton?.disabled).toBe(false);
    await act(async () => saveButton?.click());

    expect(api.selectCalendars).toHaveBeenCalledWith([workCalendar]);
    expect(onSnapshotChange).toHaveBeenCalledWith(resolved);
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
