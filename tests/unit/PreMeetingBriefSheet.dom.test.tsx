// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import type { MeetingPrep } from '../../electron/meetingPrep';
const api = vi.hoisted(() => ({
  openMeetingPrep: vi.fn(),
  buildPrepBrief: vi.fn(),
  synthesizePrepBrief: vi.fn(),
  getMeetingPrep: vi.fn(),
  getPrepForMeeting: vi.fn(),
  listPrepMeetings: vi.fn(),
  saveMeetingPrep: vi.fn(),
}));
vi.mock('../../src/api/meetingPrep', () => api);
import { PreMeetingBriefSheet } from '../../src/components/features/PreMeetingBriefSheet';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let prep: MeetingPrep;
const event: CalendarEvent = {
  occurrenceKey: 'event',
  eventIdentifier: 'id',
  calendarIdentifier: 'work',
  title: 'Launch planning',
  start: '2026-09-28T10:00:00Z',
  end: '2026-09-28T11:00:00Z',
  isAllDay: false,
  isCancelled: false,
  availability: null,
  organizer: null,
  attendees: [{ name: 'Sam', email: 'sam@example.com' }],
  lastModified: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(event.start));
  vi.clearAllMocks();
  const brief = {
    title: 'Launch',
    lastTime: [],
    stillOpen: [],
    relevantContext: [],
    overview: [],
    talkingPoints: [],
  };
  api.buildPrepBrief.mockResolvedValue(brief);
  api.synthesizePrepBrief.mockResolvedValue(brief);
  localStorage.clear();
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { on: () => () => {}, invoke: vi.fn() },
  });
  prep = {
    occurrenceKey: 'event',
    event,
    notes: '',
    topics: [],
    meetingId: null,
    recordingStarted: false,
    revision: 0,
    updatedAt: event.start,
  };
  api.openMeetingPrep.mockImplementation(async (opened) => ({
    ...structuredClone(prep),
    event: opened,
  }));
  api.getMeetingPrep.mockImplementation(async () => structuredClone(prep));
  api.listPrepMeetings.mockResolvedValue([
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      participants: 'Sam',
      preview: 'Historical launch discussion',
    },
  ]);
  api.saveMeetingPrep.mockImplementation(async (current, patch) => {
    if ('notes' in patch) prep.notes = patch.notes;
    if ('meetingIds' in patch || 'addMeetingId' in patch)
      prep.meetings = [
        {
          id: 'past',
          title: 'Launch',
          date: event.start,
          participants: 'Sam\nPunit Grover',
          preview: 'Historical launch discussion',
          context: 'Historical launch discussion',
          capturedAt: event.start,
        },
      ];
    if ('refreshMeetingId' in patch)
      prep.meetings![0].context = 'Refreshed context';
    if ('removeMeetingId' in patch) prep.meetings = [];
    prep.revision = current.revision + 1;
    return structuredClone(prep);
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const render = async (
  extra: Partial<Parameters<typeof PreMeetingBriefSheet>[0]> = {},
) => {
  await act(async () =>
    root.render(
      <PreMeetingBriefSheet
        visible
        event={event}
        onClose={() => {}}
        onOpenMeeting={() => {}}
        onStartMeeting={async () => {}}
        {...extra}
      />,
    ),
  );
};
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  )!;
const type = async (text: string) => {
  await act(async () => {
    const editor = host.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
it('opens a large editor and calendar roster without starting audio or generating a brief', async () => {
  const start = vi.fn();
  await render({ onStartMeeting: start });
  expect(start).not.toHaveBeenCalled();
  expect(window.ipcRenderer.invoke).not.toHaveBeenCalled();
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('section')?.className).toContain('max-w-3xl');
  expect(host.textContent).not.toContain('Opening prep does not record audio');
  expect(host.textContent).not.toMatch(/\d+:\d+:\d+/);
  expect(host.textContent).toContain('Sam');
  expect(host.querySelector('h2')?.title).toBe(event.title);
  expect(host.querySelector('textarea')).not.toBeNull();
});
it('autosaves preparation separately and flushes pending text before starting the selected event', async () => {
  const start = vi.fn().mockResolvedValue(undefined);
  await render({ onStartMeeting: start });
  await type('Ask about blockers');
  await act(async () => button('Start meeting').click());
  expect(api.saveMeetingPrep).toHaveBeenCalledWith(
    expect.objectContaining({ occurrenceKey: 'event' }),
    { notes: 'Ask about blockers' },
  );
  expect(start).toHaveBeenCalledWith(event);
  expect(prep.notes).toBe('Ask about blockers');
});
it('retains a failed-save draft, blocks closing, and allows explicit retry', async () => {
  const close = vi.fn();
  await render({ onClose: close });
  api.saveMeetingPrep.mockRejectedValueOnce(new Error('Offline'));
  await type('Keep my questions');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Back from meeting prep"]',
      )!
      .click(),
  );
  expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem('pluto.prep-draft:event')).toBe(
    'Keep my questions',
  );
  expect(host.textContent).toContain('Offline');
  await act(async () => button('Retry save').click());
  expect(prep.notes).toBe('Keep my questions');
});
it('manually adds, opens sources, and removes past meeting references', async () => {
  const open = vi.fn();
  await render({ onOpenMeeting: open });
  await act(async () => button('Add past meetings').click());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Include Launch"]')!
      .click(),
  );
  expect(prep.meetings).toBeUndefined();
  await act(async () => button('Save meetings').click());
  expect(api.synthesizePrepBrief).not.toHaveBeenCalled();
  await act(async () => button('Regenerate').click());
  expect(api.synthesizePrepBrief).toHaveBeenCalledOnce();
  expect(prep.meetings).toHaveLength(1);
  expect(host.querySelector('article details')).toBeNull();
  expect(host.querySelector('article')?.textContent).not.toContain(
    'Historical launch discussion',
  );
  expect(host.querySelector('[aria-label="Refresh Launch"]')).toBeNull();
  expect(host.textContent).toContain('Sep 28');
  expect(host.textContent).toContain('Sam, Punit Grover');
  await act(async () => button('Add past meetings').click());
  expect(host.querySelector('[aria-label="Open meeting: Launch"]')).toBeNull();
  await act(async () => button('Cancel').click());
  expect(
    host.querySelector('[aria-label="Open meeting: Launch"]'),
  ).not.toBeNull();

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Open meeting: Launch"]')!
      .click(),
  );
  expect(open).toHaveBeenCalledWith('past');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove Launch from prep"]',
      )!
      .click(),
  );
  expect(prep.meetings).toHaveLength(0);
});
it('disables early, expired, cancelled, and concurrent starts while opening existing recordings', async () => {
  vi.setSystemTime(new Date(Date.parse(event.start) - 300001));
  await render();
  expect(button('Start meeting').disabled).toBe(true);
  vi.setSystemTime(new Date(event.start));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(button('Start meeting').disabled).toBe(false);
  await render({ recordingBusy: true });
  expect(button('Start meeting').disabled).toBe(true);
  await render({
    recordingBusy: false,
    event: { ...event, isCancelled: true },
  });
  expect(button('Start meeting').disabled).toBe(true);
  const open = vi.fn();
  prep.meetingId = 'recorded';
  await render({ event: { ...event }, onOpenMeeting: open });
  await act(async () => button('Open meeting').click());
  expect(open).toHaveBeenCalledWith('recorded');
});
it('ignores older event-load responses', async () => {
  let resolve!: (value: MeetingPrep) => void;
  api.openMeetingPrep.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  const next = { ...event, occurrenceKey: 'next', title: 'Different meeting' };
  prep = { ...prep, event: next, occurrenceKey: 'next' };
  await render({ event: next });
  await act(async () => resolve({ ...prep, event, occurrenceKey: 'event' }));
  expect(host.querySelector('h2')?.textContent).toBe('Different meeting');
});

it('renders plain and HTML calendar links as safe external links', async () => {
  await render({
    event: {
      ...event,
      notes:
        '<p>Read <a href="https://example.com/agenda">the agenda</a></p><p>https://meet.google.com/abc-defg-hij</p><a href="javascript:alert(1)">unsafe</a>',
    },
  });
  const links = Array.from(host.querySelectorAll('a'));
  expect(links.map((link) => link.getAttribute('href'))).toContain(
    'https://example.com/agenda',
  );
  expect(links.map((link) => link.getAttribute('href'))).toContain(
    'https://meet.google.com/abc-defg-hij',
  );
  expect(links.every((link) => link.target === '_blank')).toBe(true);
  expect(
    links.some((link) => link.getAttribute('href')?.startsWith('javascript:')),
  ).toBe(false);
});

it('returns through Back after saving preparation', async () => {
  const back = vi.fn();
  await render({ onClose: back });
  expect(host.querySelector('[aria-label="Close prep"]')).toBeNull();
  await type('Question to keep');
  await act(async () => button('Back').click());
  expect(prep.notes).toBe('Question to keep');
  expect(back).toHaveBeenCalledOnce();
});

it('searches past meeting notes and ignores an older search response', async () => {
  await render();
  await act(async () => button('Add past meetings').click());
  let resolveOld!: (value: unknown) => void;
  api.listPrepMeetings.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Search past meetings"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'budget');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  api.listPrepMeetings.mockResolvedValueOnce([
    {
      id: 'budget',
      title: 'Budget review',
      date: event.start,
      participants: 'Sam',
      preview: 'Pricing notes',
    },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(api.listPrepMeetings).toHaveBeenLastCalledWith('budget', 'event');
  await act(async () => resolveOld([{ id: 'stale', title: 'Stale result' }]));
  expect(host.textContent).toContain('Budget review');
  expect(host.textContent).not.toContain('Stale result');
});

it('keeps prep open on Escape with the personal notes editor available', async () => {
  const close = vi.fn();
  await render({ onClose: close });
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
  );
  expect(close).not.toHaveBeenCalled();
  const disclosure = Array.from(host.querySelectorAll('details')).find((d) =>
    d.querySelector('summary')?.textContent?.includes('Add your notes'),
  )!;
  expect(disclosure.open).toBe(true);
  expect(disclosure.querySelector('textarea')).not.toBeNull();
});

it('cancels staged selection without saving and ignores generation from removed meetings', async () => {
  await render();
  await act(async () => button('Add past meetings').click());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Include Launch"]')!
      .click(),
  );
  await act(async () => button('Cancel').click());
  expect(api.saveMeetingPrep).not.toHaveBeenCalled();
  await act(async () => button('Add past meetings').click());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Include Launch"]')!
      .click(),
  );
  await act(async () => button('Save meetings').click());
  let finish!: (value: unknown) => void;
  api.synthesizePrepBrief.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => button('Regenerate').click());
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove Launch from prep"]',
      )!
      .click(),
  );
  await act(async () =>
    finish({
      overview: [{ id: 'stale', text: 'Stale generated content' }],
      lastTime: [],
      stillOpen: [],
      talkingPoints: [],
    }),
  );
  expect(host.textContent).not.toContain('Stale generated content');
  expect(prep.meetings).toHaveLength(0);
});

it('keeps briefing compact without duplicate overview or empty sections and uses small source markers', async () => {
  const item = {
    id: 'discussion',
    text: 'We agreed to review customer pricing before launch.',
    sourceMeetingId: 'past',
    sourceLabel: 'Launch review',
    sourceDate: event.start,
  };
  api.buildPrepBrief.mockResolvedValue({
    lastTime: [item, { ...item, id: 'duplicate' }],
    overview: [item],
    stillOpen: [],
    talkingPoints: [
      {
        ...item,
        id: 'suggested:discussion',
        text: 'What is the latest update on this?',
      },
    ],
  });
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      participants: 'Sam',
      preview: item.text,
      context: item.text,
      capturedAt: event.start,
    },
  ];
  await render();
  const headings = Array.from(host.querySelectorAll('h3,h4')).map(
    (node) => node.textContent,
  );
  expect(headings).toContain('Meeting recap');
  expect(headings).toContain('Last discussion');
  expect(headings).not.toContain('Overview');
  expect(headings).not.toContain('Open follow-ups');
  const briefing = host.querySelector('[aria-label="Meeting briefing"]')!;
  expect(briefing.querySelectorAll('li')).toHaveLength(1);
  expect(briefing.textContent).not.toContain(
    'What is the latest update on this?',
  );
  expect(
    briefing.querySelector('[aria-label="Open source: Launch review"]')
      ?.textContent,
  ).toBe('[1]');
  expect(Array.from(briefing.querySelectorAll('details'))[0].open).toBe(false);
});

it('shows a concise generated recap with the original excerpt behind disclosure', async () => {
  const source =
    'Local speaker said the review was delayed until the new draft arrived.';
  const summary =
    'The review is waiting for the new draft before it can proceed.';
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch review',
      date: event.start,
      participants: '',
      preview: source,
      context: source,
      capturedAt: event.start,
    },
  ];
  api.buildPrepBrief.mockResolvedValue({
    overview: [
      {
        id: 'history',
        text: source,
        summary,
        sourceQuote: source,
        trustStatus: 'grounded',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch review',
        sourceDate: event.start,
      },
    ],
    lastTime: [],
    stillOpen: [],
    talkingPoints: [],
    synthesisStatus: 'ready',
  });
  await render();
  const briefing = host.querySelector('[aria-label="Meeting briefing"]')!;
  expect(briefing.textContent).toContain(summary);
  expect(briefing.querySelector('summary')?.textContent).toContain(
    'Read source excerpt',
  );
  expect(briefing.querySelector('details p')?.textContent).toBe(source);
});

it('keeps existing excerpts visible while regenerating and replaces them with a completed recap', async () => {
  api.buildPrepBrief.mockResolvedValue({
    overview: [
      { id: 'old', text: 'The previous discussion remains readable.' },
    ],
    lastTime: [],
    stillOpen: [],
    talkingPoints: [],
    synthesisStatus: 'fallback',
  });
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      participants: 'Sam',
      preview: 'Previous discussion',
      context: 'Previous discussion',
      capturedAt: event.start,
    },
  ];
  await render();
  let finish!: (value: unknown) => void;
  api.synthesizePrepBrief.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => button('Regenerate').click());
  expect(host.textContent).toContain(
    'The previous discussion remains readable.',
  );
  expect(host.textContent).toContain('Refreshing recap…');
  expect(
    host
      .querySelector('[aria-label="Meeting briefing"]')
      ?.getAttribute('aria-busy'),
  ).toBe('true');
  expect(button('Regenerate').disabled).toBe(true);
  expect(host.querySelector('textarea')).not.toBeNull();
  await act(async () =>
    finish({
      overview: [
        {
          id: 'done',
          text: 'Review the latest customer pricing.',
          sourceMeetingId: 'past',
          sourceLabel: 'Launch',
          sourceDate: event.start,
        },
      ],
      lastTime: [],
      stillOpen: [],
      talkingPoints: [],
      synthesisStatus: 'ready',
    }),
  );
  expect(
    host.querySelector('[aria-label="Preparing meeting briefing"]'),
  ).toBeNull();
  expect(host.textContent).toContain('Review the latest customer pricing.');
  expect(button('Regenerate').disabled).toBe(false);
});

it('keeps the last successful recap when regeneration falls back', async () => {
  const previous = {
    id: 'previous',
    text: 'The prior decision remains visible.',
    sourceMeetingId: 'past',
    sourceLabel: 'Launch review',
    sourceDate: event.start,
    trustStatus: 'grounded',
  };
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch review',
      date: event.start,
      participants: '',
      preview: previous.text,
      context: previous.text,
      capturedAt: event.start,
    },
  ];
  api.buildPrepBrief.mockResolvedValue({
    overview: [previous],
    lastTime: [previous],
    stillOpen: [],
    talkingPoints: [],
    synthesisStatus: 'ready',
  });
  api.synthesizePrepBrief.mockResolvedValueOnce({
    overview: [],
    lastTime: [],
    stillOpen: [],
    talkingPoints: [],
    synthesisStatus: 'fallback',
  });
  await render();
  await act(async () => button('Regenerate').click());
  expect(host.textContent).toContain(previous.text);
  expect(host.textContent).toContain('last successful version is still shown');
});

it('refreshes a selected meeting snapshot through the explicit card control', async () => {
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      participants: '',
      preview: 'Earlier context',
      context: 'Earlier context',
      capturedAt: event.start,
    },
  ];
  await render();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Refresh saved notes for Launch"]',
      )!
      .click(),
  );
  expect(api.saveMeetingPrep).toHaveBeenCalledWith(
    expect.objectContaining({ occurrenceKey: 'event' }),
    { refreshMeetingId: 'past' },
  );
});

it('labels uncertain excerpts and separates commitments by confirmed ownership', async () => {
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch review',
      date: event.start,
      participants: '',
      preview: '',
      context: 'Review required',
      capturedAt: event.start,
    },
  ];
  api.buildPrepBrief.mockResolvedValue({
    overview: [
      {
        id: 'history',
        text: 'A point that needs verification.',
        trustStatus: 'needs_review',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch review',
        sourceDate: event.start,
      },
    ],
    lastTime: [],
    stillOpen: [
      {
        id: 'mine',
        text: 'Send the draft',
        ownerScope: 'self',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch review',
      },
      {
        id: 'theirs',
        text: 'Review the draft',
        ownerScope: 'other',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch review',
      },
      {
        id: 'unknown',
        text: 'Confirm the date',
        ownerScope: 'unconfirmed',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch review',
      },
    ],
    talkingPoints: [],
    synthesisStatus: 'fallback',
  });
  await render();
  expect(host.textContent).toContain('Needs review');
  expect(host.textContent).toContain('Your commitments');
  expect(host.textContent).toContain('Other commitments');
  expect(host.textContent).toContain('Ownership unconfirmed');
});

it('shows calendar agenda in a collapsible tile with a right-side chevron', async () => {
  await render({
    event: { ...event, agenda: 'Review launch timing and the budget.' },
  });
  const agenda = host.querySelector('[aria-label="Calendar agenda"]')!;
  expect(agenda.tagName).toBe('DETAILS');
  expect(agenda.hasAttribute('open')).toBe(false);
  expect(agenda.className).toContain('rounded-xl');
  const summary = agenda.querySelector('summary')!;
  expect(summary.textContent).toContain('Calendar agenda');
  expect(summary.className).toContain('justify-between');
  expect(summary.querySelector('svg')).not.toBeNull();
  expect(agenda.textContent).toContain('Review launch timing and the budget.');
});

it('includes a newly linked meeting even when the overview selects only the earlier meeting', async () => {
  const first = {
    id: 'one',
    text: 'Earlier meeting agreed on pricing.',
    sourceMeetingId: 'past',
    sourceLabel: 'Launch',
    sourceDate: event.start,
  };
  const added = {
    id: 'two',
    text: 'Newly included meeting discussed onboarding.',
    sourceMeetingId: 'new',
    sourceLabel: 'Customer sync',
    sourceDate: event.start,
  };
  api.buildPrepBrief.mockResolvedValue({
    overview: [first],
    lastTime: [first, added],
    evidenceItems: [first, added],
    stillOpen: [],
    talkingPoints: [],
  });
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      participants: '',
      preview: '',
      context: first.text,
      capturedAt: event.start,
    },
    {
      id: 'new',
      title: 'Customer sync',
      date: event.start,
      participants: '',
      preview: '',
      context: added.text,
      capturedAt: event.start,
    },
  ];
  await render();
  const briefing = host.querySelector('[aria-label="Meeting briefing"]')!;
  expect(briefing.textContent).toContain(first.text);
  expect(briefing.textContent).toContain(added.text);
  expect(api.synthesizePrepBrief).not.toHaveBeenCalled();
});

it('shows the personal notes editor before included meetings and opens it by default', async () => {
  await render();
  const notes = host.querySelector('textarea[aria-label="Preparation notes"]')!;
  expect(notes.closest('details')?.hasAttribute('open')).toBe(true);
  const headings = [...host.querySelectorAll('h3')];
  const meetings = headings.find((h) => h.textContent === 'Included meetings')!;
  expect(
    notes.compareDocumentPosition(meetings) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('Escape discards the picker selection, restores focus, and leaves prep open', async () => {
  const close = vi.fn();
  await render({ onClose: close });
  await act(async () => button('Add past meetings').click());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Include Launch"]')!
      .click(),
  );
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(host.querySelector('[aria-label="Search past meetings"]')).toBeNull();
  expect(api.saveMeetingPrep).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button('Add past meetings'));
  await act(async () => button('Add past meetings').click());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Include Launch"]')!
      .checked,
  ).toBe(false);
});

it('shows all open action items even when the overview fills the briefing budget', async () => {
  const overview = Array.from({ length: 6 }, (_, i) => ({
    id: `overview-${i}`,
    text: `Discussion context ${i}`,
    sourceMeetingId: 'past',
    sourceLabel: 'Launch',
  }));
  api.buildPrepBrief.mockResolvedValue({
    title: event.title,
    startsAt: event.start,
    overview,
    lastTime: overview,
    stillOpen: [
      {
        id: 'action-1',
        text: 'Send the updated launch checklist',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch',
      },
      {
        id: 'action-2',
        text: 'Confirm the customer trial dates',
        sourceMeetingId: 'past',
        sourceLabel: 'Launch',
      },
    ],
    talkingPoints: [],
  } as never);
  prep.meetings = [
    {
      id: 'past',
      title: 'Launch',
      date: event.start,
      context: 'Launch discussion',
      participants: '',
      preview: '',
      capturedAt: event.start,
    },
  ];
  const open = vi.fn();
  await render({ onOpenMeeting: open });
  expect(host.textContent).toContain('Ownership unconfirmed');
  expect(host.textContent).toContain('Send the updated launch checklist');
  expect(host.textContent).toContain('Confirm the customer trial dates');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Open action item source: Launch"]',
      )!
      .click(),
  );
  expect(open).toHaveBeenCalledWith('past');
});
