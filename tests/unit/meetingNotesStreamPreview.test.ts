import { expect, it, vi } from 'vitest';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { createNotesStreamPreview } from '../../electron/llm/meetingNotesStreamPreview';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

const source = createNotesSource(
  JSON.stringify({
    segments: [
      {
        speaker: 'A',
        text: 'Check the draft {carefully}. Then wait for approval.',
      },
      { speaker: 'B', text: 'Agreed. The label is "東京".' },
    ],
  }),
);
const spans = source.segments.map((s) => ({
  segment: s.index,
  start: 0,
  end: s.text.length,
}));
const wire = createNotesWireRequest('', spans);
const item = (index: number) => ({
  kind: 'point',
  text: source.segments[index].text,
  owner: null,
  due: null,
  sources: [`R${index}`],
});
const first = `{"title":null,"sections":[{"title":"Context","items":[${JSON.stringify(item(0))}`;
const full = `${first},${JSON.stringify(item(1))}]}]}`;
const setup = (signal?: AbortSignal, suppliedSpans = spans) => {
  const onDraft = vi.fn();
  const push = createNotesStreamPreview({
    source,
    spans: suppliedSpans,
    decode: wire.decode,
    onDraft,
    signal,
  });
  return { onDraft, push };
};

it('shows the first complete bullet before the document terminates, never partial text', () => {
  const { onDraft, push } = setup();
  for (let end = 1; end < first.length; end++) push(first.slice(0, end));
  expect(onDraft).not.toHaveBeenCalled();
  push(first);
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(onDraft.mock.calls[0][0].sections[0].items).toHaveLength(1);
  push(full);
  expect(onDraft).toHaveBeenCalledTimes(2);
  expect(
    onDraft.mock.calls[1][0].sections[0].items.map(
      (i: { text: string }) => i.text,
    ),
  ).toEqual(source.segments.map((s) => s.text));
  push(full);
  expect(onDraft).toHaveBeenCalledTimes(2);
});
it('clears attempt state on retry rather than concatenating answers', () => {
  const { onDraft, push } = setup();
  push(first);
  push('');
  expect(onDraft.mock.calls.at(-1)?.[0].sections).toEqual([]);
  push(first);
  expect(onDraft.mock.calls.at(-1)?.[0].sections[0].items).toHaveLength(1);
});
it('does not expose leaf-only source or emit after cancellation', () => {
  const leaf = setup(undefined, [spans[0]]);
  leaf.push(first);
  expect(leaf.onDraft).not.toHaveBeenCalled();
  const controller = new AbortController();
  const { onDraft, push } = setup(controller.signal);
  controller.abort();
  push(first);
  expect(onDraft).not.toHaveBeenCalled();
});
it.each([
  first.replace('R0', 'R999'),
  first.replace('"point"', '"invented"'),
  '{"title":null,"sections":[{"title":"Context","items":[{"text":"unfinished',
  'x'.repeat(64001),
  '{"title":null,"sections":]}',
])('rejects unsafe or incomplete prefixes without model repair', (raw) => {
  const { onDraft, push } = setup();
  push(raw);
  expect(onDraft).not.toHaveBeenCalled();
});
it('isolates observer failures from generation', () => {
  const push = createNotesStreamPreview({
    source,
    spans,
    decode: wire.decode,
    onDraft: () => {
      throw new Error('UI unavailable');
    },
  });
  expect(() => push(first)).not.toThrow();
});

it('ignores empty canonical rows just as the writer source serializer does', () => {
  const withEmpty = createNotesSource(
    JSON.stringify({
      segments: [...source.segments, { speaker: null, text: ' ' }],
    }),
  );
  const onDraft = vi.fn();
  createNotesStreamPreview({
    source: withEmpty,
    spans,
    decode: wire.decode,
    onDraft,
  })(first);
  expect(onDraft).toHaveBeenCalledTimes(1);
});
