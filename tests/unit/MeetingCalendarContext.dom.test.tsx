// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingCalendarContext } from '../../src/components/features/MeetingCalendarContext';

const context = {
  sourceKind: 'macos_calendar' as const,
  occurrenceKey: 'event-a',
  calendarTitle: 'Work',
  matchOrigin: 'automatic' as const,
  matchEvidence: 'time_overlap' as const,
  event: {
    occurrenceKey: 'event-a',
    eventIdentifier: 'event-a',
    calendarIdentifier: 'calendar-a',
    title: 'Product review',
    start: '2026-08-30T17:30:00.000Z',
    end: '2026-08-30T18:30:00.000Z',
    isAllDay: false,
    isCancelled: false,
    availability: 'busy',
    organizer: { name: 'Alex', email: 'alex@example.com' },
    attendees: [{ name: 'Sam', email: 'sam@example.com' }],
    lastModified: null,
  },
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('MeetingCalendarContext', () => {
  it('labels calendar provenance and offers a deliberate title suggestion', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onUseTitle = vi.fn();
    act(() =>
      root.render(
        <MeetingCalendarContext
          context={context}
          canSuggestTitle={true}
          onUseTitle={onUseTitle}
        />,
      ),
    );
    expect(container.textContent).toContain('From Calendar · Work');
    expect(container.textContent).toContain('Product review');
    expect(container.textContent).toContain('Alex');
    expect(container.textContent).toContain('Sam');
    container.querySelector<HTMLButtonElement>('button')?.click();
    expect(onUseTitle).toHaveBeenCalledWith('Product review');
    act(() => root.unmount());
  });

  it('never offers to replace an existing user title', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <MeetingCalendarContext
          context={context}
          canSuggestTitle={false}
          onUseTitle={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('button')).toBeNull();
    act(() => root.unmount());
  });
});
