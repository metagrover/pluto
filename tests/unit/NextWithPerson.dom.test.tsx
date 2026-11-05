// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const notesApi = vi.hoisted(() => ({
  saveNote: vi.fn(),
  setNoteChecklistItem: vi.fn(),
  getNotesForEntity: vi.fn(async () => []),
  getNextTimeDiscussed: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../../src/api/notes', () => notesApi);

import {
  NextWithPerson,
  openItemsFromNotes,
} from '../../src/components/KnowledgeGraph/NextWithPerson';
import type { Note } from '../../src/types/notes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const priya = { id: 'p1', name: 'Priya Shah' };
const note = (overrides: Partial<Note>): Note => ({
  id: 'n1',
  title: '1:1 with Priya',
  content: '',
  noteType: 'person',
  targetId: 'p1',
  targetName: 'Priya Shah',
  pinned: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
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

it('lists open checklist items from notes about the person, newest first', () => {
  const items = openItemsFromNotes([
    note({
      id: 'old',
      content: '- [ ] Old question',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }),
    note({
      id: 'new',
      content:
        'Agenda\n- [ ] Ask about comp bands\n- [x] Done already\n- [ ] [task] Send doc',
    }),
  ]);
  expect(items.map((item) => [item.noteId, item.lineIndex, item.text])).toEqual(
    [
      ['new', 1, 'Ask about comp bands'],
      ['old', 0, 'Old question'],
    ],
  );
});

it('ticks an item in its note and keeps it visible, struck through', async () => {
  notesApi.setNoteChecklistItem.mockResolvedValue({});
  await act(async () =>
    root.render(
      <NextWithPerson
        person={priya}
        notes={[note({ content: '- [ ] Ask about comp bands' })]}
      />,
    ),
  );
  expect(host.textContent).toContain('Next time with Priya Shah');
  const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => box.click());
  expect(notesApi.setNoteChecklistItem).toHaveBeenCalledWith({
    noteId: 'n1',
    lineIndex: 0,
    text: 'Ask about comp bands',
    checked: true,
  });
  expect(host.querySelector('.line-through')?.textContent).toBe(
    'Ask about comp bands',
  );
});

const typeAndSubmit = async (value: string) => {
  const input = host.querySelector('input[type="text"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
};

it('adds something to raise to the person’s latest note', async () => {
  notesApi.saveNote.mockResolvedValue({});
  await act(async () =>
    root.render(
      <NextWithPerson person={priya} notes={[note({ content: 'Agenda' })]} />,
    ),
  );
  await typeAndSubmit('Conference budget');
  expect(notesApi.saveNote).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'n1',
      content: 'Agenda\n- [ ] Conference budget',
      targetId: 'p1',
    }),
  );
});

it('starts a 1:1 note for the person when there is none yet', async () => {
  notesApi.saveNote.mockResolvedValue({});
  await act(async () =>
    root.render(<NextWithPerson person={priya} notes={[]} />),
  );
  await typeAndSubmit('Ask about comp bands');
  expect(notesApi.saveNote).toHaveBeenCalledWith({
    title: '1:1 with Priya Shah',
    content: '- [ ] Ask about comp bands',
    noteType: 'person',
    targetId: 'p1',
  });
});

it('offers Start 1:1 only when recording can start', async () => {
  const start = vi.fn();
  await act(async () =>
    root.render(<NextWithPerson person={priya} notes={[]} />),
  );
  expect(host.textContent).not.toContain('Start 1:1');
  await act(async () =>
    root.render(
      <NextWithPerson person={priya} notes={[]} onStartMeeting={start} />,
    ),
  );
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Start 1:1',
  )!;
  await act(async () => button.click());
  expect(start).toHaveBeenCalled();
});

it('says softly when an item came up in the latest meeting, and can hide it', async () => {
  localStorage.clear();
  notesApi.getNextTimeDiscussed.mockResolvedValue([
    {
      key: 'n1:0',
      meetingId: 'm1',
      meetingTitle: 'Priya / me 1:1',
      startedAt: '2026-11-03T10:00:00.000Z',
      atSeconds: 42,
    },
  ]);
  const openMeeting = vi.fn();
  await act(async () =>
    root.render(
      <NextWithPerson
        person={priya}
        notes={[note({ content: '- [ ] Hiring plan for Q1\n- [ ] Offsite' })]}
        onOpenMeeting={openMeeting}
      />,
    ),
  );
  expect(notesApi.getNextTimeDiscussed).toHaveBeenCalledWith('p1', [
    { key: 'n1:0', noteId: 'n1', text: 'Hiring plan for Q1' },
    { key: 'n1:1', noteId: 'n1', text: 'Offsite' },
  ]);
  expect(host.textContent).toContain('Came up in');
  const link = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Priya / me 1:1'),
  )!;
  await act(async () => link.click());
  expect(openMeeting).toHaveBeenCalledWith('m1');
  // The item itself stays until ticked.
  expect(host.textContent).toContain('Hiring plan for Q1');
  const hide = host.querySelector(
    '[aria-label="Hide “came up” for Hiring plan for Q1"]',
  ) as HTMLButtonElement;
  await act(async () => hide.click());
  expect(host.textContent).not.toContain('Came up in');
  expect(host.textContent).toContain('Hiring plan for Q1');
});
