import { expect, it } from 'vitest';
import type { Note } from '../../src/types/notes';
import { suggestNoteForMeeting } from '../../src/utils/meetingNoteSuggestion';

const now = Date.parse('2026-11-04T12:00:00.000Z');
const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  title: id,
  content: 'Something to discuss',
  noteType: 'general',
  pinned: false,
  createdAt: '2026-11-04T08:00:00.000Z',
  updatedAt: '2026-11-04T08:00:00.000Z',
  ...extra,
});

const suggest = (notes: Note[], extra = {}) =>
  suggestNoteForMeeting({
    notes,
    title: 'Acme call',
    people: ['Dana Ortiz'],
    currentNotes: '',
    now,
    ...extra,
  })?.id ?? null;

it('offers a recent note that mentions someone in the meeting', () => {
  expect(
    suggest([note('vendor', { content: 'Ask @Dana Ortiz about residency' })]),
  ).toBe('vendor');
  expect(suggest([note('linked', { targetName: 'Dana Ortiz' })])).toBe(
    'linked',
  );
});

it('offers a recent note titled like the meeting', () => {
  expect(suggest([note('x', { title: 'Acme  call' })])).toBe('x');
});

it('offers the most recently edited match', () => {
  expect(
    suggest([
      note('older', { title: 'Acme call', updatedAt: '2026-11-04T07:00:00Z' }),
      note('newer', { title: 'Acme call', updatedAt: '2026-11-04T11:00:00Z' }),
    ]),
  ).toBe('newer');
});

it('leaves out old, empty, unrelated, running person notes and notes already used', () => {
  expect(
    suggest([
      note('old', { title: 'Acme call', updatedAt: '2026-11-02T08:00:00Z' }),
      note('empty', { title: 'Acme call', content: '  ' }),
      note('unrelated', { content: 'Talk to Danais later' }),
      note('running', {
        title: 'Acme call',
        noteType: 'person',
        targetName: 'Dana Ortiz',
      }),
    ]),
  ).toBeNull();
  expect(
    suggest([note('used', { title: 'Acme call', content: 'Agenda' })], {
      currentNotes: 'Agenda\n\nmore',
    }),
  ).toBeNull();
});
