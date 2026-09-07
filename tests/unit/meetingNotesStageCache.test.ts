import { expect, it } from 'vitest';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it('expires and bounds completed parsed drafts and never exposes mutable cached data', () => {
  let now = 0;
  const cache = new NotesStageCache(() => now);
  const draft = makeDirectNotesFixture().draft;
  cache.set('first', draft);
  cache.get('first')!.sections[0]!.title.text = 'Mutated';
  expect(cache.get('first')!.sections[0]!.title.text).toBe('Outline');
  for (let i = 0; i < 64; i++) cache.set(`next${i}`, draft);
  expect(cache.get('first')).toBeUndefined();
  expect(cache.get('next0')).toBeDefined();
  now = 15 * 60 * 1000;
  expect(cache.get('next63')).toBeUndefined();
});

it('bounds, expires and clones completed reconciliations independently', () => {
  let now = 0;
  const cache = new NotesStageCache(() => now);
  const reconciliation = {
    facts: [
      {
        id: 'inventory:0:facts:0',
        text: 'A source fact',
        sources: [{ segment: 0, start: 0, end: 4 }],
      },
    ],
    actions: [],
    decisions: [],
    questions: [],
  };
  cache.setReconciliation('first', reconciliation);
  cache.getReconciliation('first')!.facts[0]!.sources[0]!.start = 2;
  expect(cache.getReconciliation('first')!.facts[0]!.sources[0]!.start).toBe(0);
  for (let index = 0; index < 64; index++) {
    cache.setReconciliation(`next${index}`, reconciliation);
  }
  expect(cache.getReconciliation('first')).toBeUndefined();
  expect(cache.getReconciliation('next0')).toBeDefined();
  now = 15 * 60 * 1000;
  expect(cache.getReconciliation('next63')).toBeUndefined();
});

it('supports a bounded meeting-length lifetime for incremental leaf reuse', () => {
  let now = 0;
  const cache = new NotesStageCache(() => now, 60 * 60 * 1000);
  cache.set('leaf', makeDirectNotesFixture().draft);

  now = 45 * 60 * 1000;
  expect(cache.get('leaf')).toBeDefined();
  now = 60 * 60 * 1000;
  expect(cache.get('leaf')).toBeUndefined();
});
