import { expect, it } from 'vitest';
import {
  parseNotesOverview,
  prepareNotesOverview,
} from '../../electron/llm/meetingNotesOverview';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';

const source = createNotesSource(
  JSON.stringify({
    segments: [
      { speaker: 'Milo', text: 'I finished the diagram yesterday.' },
      { speaker: 'Nora', text: 'I will send the diagram on Friday.' },
    ],
  }),
);
const spans = source.segments.map((segment) => ({
  segment: segment.index,
  start: 0,
  end: segment.text.length,
}));

it('admits only the complete canonical packet, keeping speaker boundaries and original source intact', () => {
  const original = structuredClone(source);
  const request = prepareNotesOverview(
    source,
    spans.map(({ segment, start, end }) => ({ end, start, segment })),
    16384,
  )!;
  expect(request).not.toBeNull();
  expect(request.sources).toEqual(spans);
  expect(JSON.parse(request.prompt.split('\n').at(-1)!)[0].source).toEqual(
    source.segments.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      bounds: [[segment.index, 0, segment.text.length]],
    })),
  );
  expect(request.outputTokens).toBe(1536);
  expect(request.prompt).toContain(
    "Write prose in SOURCE DATA's primary language",
  );
  expect(source).toEqual(original);
});

it('does not select, trim or reinterpret a partial writer packet to fit a global summary', () => {
  expect(prepareNotesOverview(source, spans.slice(0, 1), 16384)).toBeNull();
  expect(
    prepareNotesOverview(
      source,
      [spans[0]!, { ...spans[1]!, end: spans[1]!.end - 1 }],
      16384,
    ),
  ).toBeNull();
  expect(prepareNotesOverview(source, spans, 512)).toBeNull();
});

it('keeps composed long-meeting summaries on their existing path beyond the summary evidence cap', () => {
  const long = createNotesSource(
    JSON.stringify({
      segments: Array.from({ length: 37 }, () => ({
        speaker: 'Milo',
        text: 'The workshop is open.',
      })),
    }),
  );
  expect(
    prepareNotesOverview(
      long,
      long.segments.map((s) => ({
        segment: s.index,
        start: 0,
        end: s.text.length,
      })),
      16384,
    ),
  ).toBeNull();
});

const resolution = {
  id: 'overview',
  kind: 'point',
  text: 'Milo completed the diagram; Nora will send it on Friday.',
  owner: null,
  due: null,
  discussion: null,
};
it('parses factual overview prose without accepting task metadata or extra generated fields', () => {
  expect(
    parseNotesOverview(JSON.stringify({ resolutions: [resolution] })),
  ).toBe(resolution.text);
  for (const value of [
    null,
    {},
    { resolutions: [] },
    { resolutions: [resolution, resolution] },
    { resolutions: [{ ...resolution, kind: 'accepted_action' }] },
    { resolutions: [{ ...resolution, owner: 'Nora' }] },
    { resolutions: [{ ...resolution, due: 'Friday' }] },
    { resolutions: [{ ...resolution, discussion: 'Extra claim' }] },
    { resolutions: [{ ...resolution, sources: [] }] },
    { resolutions: [{ ...resolution, text: ' ' }] },
    { resolutions: [{ ...resolution, text: 'x'.repeat(1601) }] },
  ])
    expect(() => parseNotesOverview(JSON.stringify(value))).toThrow(
      'notes_semantic_review_incomplete',
    );
});
