import { expect, it } from 'vitest';
import {
  completeCitedSourceWindow,
  createNotesSource,
  hasBareNotesReferent,
  resolveSourceSpan,
  sourceBoundReviewWindow,
} from '../../electron/llm/meetingNotesSource';

it('completes partial turns so a review sees negation and named actors, omitting blank turns', () => {
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Me', text: 'I will not book the review.' },
      { speaker: 'Them', text: ' ' },
      { speaker: 'Nora', text: 'Riley will send the checklist Monday.' },
    ]),
  );
  const spans = [
    { segment: 2, start: 6, end: 10 },
    { segment: 0, start: 11, end: 15 },
  ];
  const before = structuredClone(spans);
  const window = completeCitedSourceWindow(source, spans);
  expect(window.map((span) => resolveSourceSpan(source, span))).toEqual([
    'I will not book the review.',
    'Riley will send the checklist Monday.',
  ]);
  expect(spans).toEqual(before);
  expect(completeCitedSourceWindow(source, [])).toEqual([]);
});

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

it.each([
  'I declined that invitation because I needed rest.',
  'Those examples helped me understand the theorem.',
  'This happened before the archive opened.',
  'These were the paintings I remembered.',
  'Such a change would need another discussion.',
])(
  'supplies exact prior context for a general backward reference: %s',
  (text) => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker: 'Ari', text: 'The earlier discussion is unrelated.' },
        { speaker: 'Bo', text: 'We moved to another subject.' },
        { speaker: 'Ari', text: 'Here is the relevant earlier statement.' },
        { speaker: 'Bo', text },
      ]),
    );
    const current = source.segments[3]!;
    const initial = [
      { segment: current.index, start: 0, end: current.text.length },
    ];
    const window = sourceBoundReviewWindow(source, initial);
    expect(window.map(({ segment }) => segment)).toEqual([0, 1, 2, 3]);
    expect(resolveSourceSpan(source, window[2]!)).toBe(
      'Here is the relevant earlier statement.',
    );
    expect(sourceBoundReviewWindow(source, window)).toEqual(window);
  },
);

it('bounds generic references to complete prior speaker turns without replay growth', () => {
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Ari', text: 'An unrelated opening.' },
      { speaker: 'Bo', text: 'This came from an older subject.' },
      { speaker: 'Ari', text: 'The invitation was to exhibit a painting' },
      { speaker: 'Ari', text: 'at the autumn show.' },
      { speaker: 'Bo', text: 'I needed rest.' },
      { speaker: 'Ari', text: 'We can discuss another date.' },
      { speaker: 'Bo', text: 'I declined that invitation.' },
    ]),
  );
  const window = sourceBoundReviewWindow(source, [
    { segment: 6, start: 0, end: source.segments[6]!.text.length },
  ]);
  expect(window.map(({ segment }) => segment)).toEqual([2, 3, 4, 5, 6]);
  expect(sourceBoundReviewWindow(source, window)).toEqual(window);
  expect(source.segments[2]!.text).toBe(
    'The invitation was to exhibit a painting',
  );
});

it('does not fabricate preceding evidence for a first-turn demonstrative', () => {
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Ari', text: 'I declined that invitation.' }]),
  );
  const initial = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  expect(sourceBoundReviewWindow(source, initial)).toEqual(initial);
});

it.each([
  'I enjoyed that day.',
  'I am studying this year.',
  'I know that it happened.',
])(
  'extra context selection does not classify self-contained wording as unresolved: %s',
  (text) => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker: 'Ari', text: 'An earlier source statement.' },
        { speaker: 'Bo', text },
      ]),
    );
    expect(
      sourceBoundReviewWindow(source, [
        { segment: 1, start: 0, end: text.length },
      ]).map(({ segment }) => segment),
    ).toEqual([0, 1]);
    expect(hasBareNotesReferent(text)).toBe(false);
  },
);

it('keeps the canonical projection revision stable while preserving explicit same-label trust', () => {
  const raw = JSON.stringify([
    { speaker: 'Remote Speaker 1', text: 'I am Ellis.' },
  ]);
  const original = createNotesSource(raw);
  const confirmed = createNotesSource(raw, {
    'Remote Speaker 1': 'Remote Speaker 1',
  });
  expect(confirmed.segments).toEqual(original.segments);
  expect(confirmed.revision).toBe(original.revision);
  expect(confirmed.protectedSpeakerLabels).toEqual(['Remote Speaker 1']);
  expect(raw).toBe(
    JSON.stringify([{ speaker: 'Remote Speaker 1', text: 'I am Ellis.' }]),
  );
});
