// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const prepApi = vi.hoisted(() => ({
  openMeetingPrep: vi.fn(),
  saveMeetingPrep: vi.fn(),
}));
vi.mock('../../src/api/meetingPrep', () => prepApi);

import {
  NoteMeetingMenu,
  prepNotesWith,
  upcomingForPrep,
} from '../../src/components/features/notes/NoteMeetingMenu';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse('2026-11-04T09:00:00.000Z');
const event = (key: string, startHour: number, extra = {}) => ({
  occurrenceKey: key,
  title: `Meeting ${key}`,
  start: new Date(now + startHour * 3600e3).toISOString(),
  end: new Date(now + (startHour + 1) * 3600e3).toISOString(),
  isCancelled: false,
  attendees: [],
  ...extra,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('offers meetings that have not ended, soonest first, skipping cancelled ones', () => {
  const offered = upcomingForPrep(
    [
      event('later', 5),
      event('past', -3),
      event('cancelled', 2, { isCancelled: true }),
      event('soon', 1),
      { title: 'No key' },
    ],
    now,
  );
  expect(offered.map((e) => e.occurrenceKey)).toEqual(['soon', 'later']);
});

it('adds a note to prep notes once', () => {
  expect(prepNotesWith('', 'Questions')).toBe('Questions');
  expect(prepNotesWith('Agenda', 'Questions')).toBe('Agenda\n\nQuestions');
  expect(prepNotesWith('Agenda\n\nQuestions', 'Questions')).toBe(
    'Agenda\n\nQuestions',
  );
});

it('starts a meeting with the note as its notes and the linked person', async () => {
  const start = vi.fn();
  await act(async () =>
    root.render(
      <NoteMeetingMenu
        title="Vendor eval"
        content="- [ ] Data residency"
        personName="Dana Ortiz"
        events={[]}
        onStartMeeting={start}
      />,
    ),
  );
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Start meeting now',
  )!;
  await act(async () => button.click());
  expect(start).toHaveBeenCalledWith({
    title: 'Vendor eval',
    participants: ['Dana Ortiz'],
    notes: '- [ ] Data residency',
  });
});

it('puts the note into an upcoming meeting’s prep and says so', async () => {
  const upcoming = event('acme', 1);
  upcoming.start = new Date(Date.now() + 3600e3).toISOString();
  upcoming.end = new Date(Date.now() + 7200e3).toISOString();
  prepApi.openMeetingPrep.mockResolvedValue({ notes: 'Agenda', revision: 1 });
  prepApi.saveMeetingPrep.mockResolvedValue({});
  await act(async () =>
    root.render(
      <NoteMeetingMenu
        title="Vendor eval"
        content="Questions for Dana"
        personName={null}
        events={[upcoming]}
      />,
    ),
  );
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Meeting acme'),
  )!;
  await act(async () => button.click());
  expect(prepApi.saveMeetingPrep).toHaveBeenCalledWith(
    { notes: 'Agenda', revision: 1 },
    { notes: 'Agenda\n\nQuestions for Dana' },
  );
  expect(host.textContent).toContain('Added to the prep for Meeting acme');
});

it('hides itself when there is nothing it can do', async () => {
  await act(async () =>
    root.render(
      <NoteMeetingMenu title="x" content="" personName={null} events={[]} />,
    ),
  );
  expect(host.textContent).toBe('');
});
