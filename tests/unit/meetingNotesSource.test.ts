import { expect, it } from 'vitest';
import {
  createNotesSource,
  resolveSourceSpan,
} from '../../electron/llm/meetingNotesSource';

it('projects confirmed speaker names without mutating canonical input', () => {
  const raw = JSON.stringify({
    segments: [{ speaker: 'Them', text: 'I will review it.' }],
  });
  const canonical = createNotesSource(raw);
  const projected = createNotesSource(raw, { Them: 'Alex' });

  expect(canonical.segments[0].speaker).toBe('Them');
  expect(projected.segments[0].speaker).toBe('Alex');
  expect(projected.revision).not.toBe(canonical.revision);
  expect(JSON.parse(raw).segments[0].speaker).toBe('Them');
});

it('resolves original words without mutating source or borrowing live text', () => {
  const raw = JSON.stringify({
    segments: [{ speaker: 'Me', text: "Um, I'll send the outline." }],
    liveSegments: [{ speaker: 'Me', text: "I'll send the contract." }],
  });
  const source = createNotesSource(raw);
  const originalText = "Um, I'll send the outline.";

  expect(source.segments[0]?.text).toBe(originalText);
  expect(
    resolveSourceSpan(source, {
      segment: 0,
      start: 4,
      end: originalText.length,
    }),
  ).toBe("I'll send the outline.");
  expect(raw).toContain('liveSegments');
  expect(() =>
    resolveSourceSpan(source, { segment: 0, start: -1, end: 25 }),
  ).toThrow('invalid_source_span');
});

it('rejects a source span that splits a surrogate pair', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [{ speaker: 'Me', text: 'Plan \ud83d\udc4d today.' }],
    }),
  );

  expect(() =>
    resolveSourceSpan(source, { segment: 0, start: 5, end: 6 }),
  ).toThrow('invalid_source_span');
});

it('resolves reordered and sparse source indexes with the same span validation', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: 'Outline' },
        { speaker: 'Them', text: 'Review' },
      ],
    }),
  );
  const reordered = { ...source, segments: [...source.segments].reverse() };
  expect(resolveSourceSpan(reordered, { segment: 0, start: 0, end: 7 })).toBe(
    'Outline',
  );
  const sparse = {
    ...source,
    segments: [{ ...source.segments[0], index: 10 }],
  };
  expect(resolveSourceSpan(sparse, { segment: 10, start: 0, end: 7 })).toBe(
    'Outline',
  );
  expect(() =>
    resolveSourceSpan(sparse, { segment: 0, start: 0, end: 7 }),
  ).toThrow('invalid_source_span');
});

it('keeps source revisions sensitive to speaker and canonical text changes', () => {
  const first = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text: 'Ship it.' }] }),
  );
  const differentSpeaker = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Them', text: 'Ship it.' }] }),
  );
  const changedText = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text: 'Do not ship it.' }] }),
  );

  expect(first.revision).not.toBe(differentSpeaker.revision);
  expect(first.revision).not.toBe(changedText.revision);
});

it('preserves legacy numeric speaker labels as canonical strings', () => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 2, text: 'Ship it.' }] }),
  );

  expect(source.segments).toEqual([
    { index: 0, speaker: '2', text: 'Ship it.' },
  ]);
  expect(Object.isFrozen(source.segments)).toBe(true);
  expect(Object.isFrozen(source.segments[0])).toBe(true);
});

it('preserves original indexes when an empty segment has no prompt text', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: '' },
        { speaker: 'Them', text: 'Keep this source index.' },
      ],
    }),
  );

  expect(source.segments.map(({ index }) => index)).toEqual([0, 1]);
  expect(resolveSourceSpan(source, { segment: 1, start: 0, end: 23 })).toBe(
    'Keep this source index.',
  );
});

it('rejects empty and malformed canonical transcripts', () => {
  expect(() => createNotesSource('{not json')).toThrow('invalid_notes_source');
  expect(() => createNotesSource(JSON.stringify({ segments: [] }))).toThrow(
    'invalid_notes_source',
  );
  expect(() =>
    createNotesSource(
      JSON.stringify({ segments: [{ speaker: 'Me', text: 4 }] }),
    ),
  ).toThrow('invalid_notes_source');
});
