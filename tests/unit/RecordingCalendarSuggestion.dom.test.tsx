// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import { RecordingCalendarSuggestion } from '../../src/components/features/RecordingCalendarSuggestion';

const event = (key: string, title: string): CalendarEvent => ({
  occurrenceKey: key,
  eventIdentifier: key,
  calendarIdentifier: 'work',
  title,
  start: '2026-10-08T09:00:00.000Z',
  end: '2026-10-08T10:00:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RecordingCalendarSuggestion', () => {
  it('requires a choice when invites overlap and leaves dismissal explicit', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    const events = [event('one', 'Planning'), event('two', 'Interview')];
    act(() =>
      root.render(
        <RecordingCalendarSuggestion
          events={events}
          selectedOccurrenceKey=""
          busy={false}
          error={null}
          onSelect={onSelect}
          onAdd={onAdd}
          onDismiss={onDismiss}
        />,
      ),
    );
    const add = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add selected calendar invite to this recording"]',
    );
    const select = container.querySelector<HTMLSelectElement>('select');
    expect(add?.disabled).toBe(true);
    expect(select?.options[0].textContent).toBe('Choose a meeting');
    act(() => {
      select!.value = 'two';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('two');
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Dismiss suggested meeting"]',
        )
        ?.click(),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('offers Add immediately for a sole invite', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdd = vi.fn();
    act(() =>
      root.render(
        <RecordingCalendarSuggestion
          events={[event('one', 'Planning')]}
          selectedOccurrenceKey="one"
          busy={false}
          error={null}
          onSelect={vi.fn()}
          onAdd={onAdd}
          onDismiss={vi.fn()}
        />,
      ),
    );
    const add = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add selected calendar invite to this recording"]',
    );
    expect(add?.disabled).toBe(false);
    act(() => add?.click());
    expect(onAdd).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
