import { expect, it } from 'vitest';
import {
  findDiscussedItems,
  itemKeywords,
  transcriptSegments,
} from '../../electron/nextTimeDiscussed';
import { parseStoredTime } from '../../src/utils/storedTime';

const meeting = {
  id: 'm1',
  title: 'Priya / me 1:1',
  startedAt: '2026-11-03T10:00:00.000Z',
  segments: [
    { text: 'Morning! How was the weekend?', start: 0 },
    { text: 'Good. So, the hiring plan.', start: 20 },
    { text: 'Right, we need two backend engineers in Q1.', start: 31 },
    { text: 'And the budget review moved to Friday.', start: 60 },
  ],
};
const before = { n1: '2026-11-02 18:00:00' };
const item = (text: string, key = 'k') => ({ key, noteId: 'n1', text });

it('keeps the distinctive words of an item, stemmed', () => {
  expect(itemKeywords('Ask about the hiring plan for backend [task]')).toEqual([
    'hir',
    'plan',
    'backend',
  ]);
});

it('marks an item whose words come up close together, with the moment', () => {
  expect(
    findDiscussedItems({
      items: [item('Hiring plan for backend engineers')],
      noteUpdatedAt: before,
      meeting,
    }),
  ).toEqual([
    {
      key: 'k',
      meetingId: 'm1',
      meetingTitle: 'Priya / me 1:1',
      startedAt: meeting.startedAt,
      atSeconds: 20,
    },
  ]);
});

it('says nothing when the words are scattered, too few, or missing', () => {
  expect(
    findDiscussedItems({
      items: [
        item('Weekend hiking photos', 'a'),
        item('Offsite', 'b'),
        item('Morning engineers budget', 'c'),
      ],
      noteUpdatedAt: before,
      meeting,
    }),
  ).toEqual([]);
});

it('skips notes edited after the meeting began, since items may be new', () => {
  expect(
    findDiscussedItems({
      items: [item('Hiring plan for backend engineers')],
      noteUpdatedAt: { n1: '2026-11-03 11:00:00' },
      meeting,
    }),
  ).toEqual([]);
});

it('reads transcripts saved as a list or as segments', () => {
  expect(transcriptSegments('[{"text":"Hi","start":1}]')).toEqual([
    { text: 'Hi', start: 1 },
  ]);
  expect(transcriptSegments('{"segments":[{"text":"Yo"}, {"x":1}]}')).toEqual([
    { text: 'Yo', start: undefined },
  ]);
  expect(transcriptSegments('nope')).toEqual([]);
});

it('reads SQLite times as UTC', () => {
  expect(parseStoredTime('2026-11-03 10:00:00')).toBe(
    Date.parse('2026-11-03T10:00:00Z'),
  );
  expect(parseStoredTime('2026-11-03T10:00:00.000Z')).toBe(
    Date.parse('2026-11-03T10:00:00Z'),
  );
  expect(Number.isNaN(parseStoredTime(''))).toBe(true);
});
