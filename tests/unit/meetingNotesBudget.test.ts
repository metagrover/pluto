import { expect, it } from 'vitest';
import {
  calculateNotesRequestBudget,
  estimateNotesTokens,
  partitionNotesSource,
  planNotesCapacity,
} from '../../electron/llm/meetingNotesBudget';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';

it('includes supplemental spans when checking the actual indexed prompt budget', () => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ text: 'First.' }, { text: 'Second.' }] }),
  );
  const leaves = partitionNotesSource(
    source,
    (_packet, spans = []) => spans.length <= 1,
  );
  expect(leaves).toHaveLength(2);
  expect(leaves[1]!.overlapSpans).toEqual([]);
});

it('reserves the draft inside the audit input, not just the writer input', () => {
  expect(
    planNotesCapacity({
      contextTokens: 16384,
      writerInputTokens: 13000,
      auditBaseInputTokens: 14000,
      writerOutputTokens: 2048,
      auditOutputTokens: 1536,
      safetyTokens: 512,
    }).mode,
  ).toBe('hierarchical');
});

it('keeps notes transport context and output inside the shared capacity policy', () => {
  expect(
    calculateNotesRequestBudget({
      prompt: 'compact prompt',
      contextTokens: 16384,
      outputTokens: 2048,
    }),
  ).toEqual({ num_ctx: 16384, num_predict: 2048 });

  expect(() =>
    calculateNotesRequestBudget({
      prompt: 'x'.repeat(20_000),
      contextTokens: 1024,
      outputTokens: 512,
    }),
  ).toThrow('notes_context_exhausted');
});

it('uses a conservative shared token estimate for dense and ordinary source text', () => {
  const prose =
    'This is an ordinary conversation with many separate words. '.repeat(20);
  expect(estimateNotesTokens(prose)).toBeLessThan(Buffer.byteLength(prose) / 2);
  const compactJson = JSON.stringify({
    descriptor: { segment: 0, start: 0, end: 30 },
    speaker: 'Milo',
    text: 'A normal conversation about the weekly review.',
  });
  expect(estimateNotesTokens(compactJson)).toBeLessThan(
    Buffer.byteLength(compactJson) / 2,
  );
  expect(estimateNotesTokens('abc')).toBe(2);
  expect(estimateNotesTokens('東京')).toBe(Buffer.byteLength('東京'));
  expect(estimateNotesTokens(`const ${'identifier'.repeat(8)} = 1`)).toBe(
    Buffer.byteLength(`const ${'identifier'.repeat(8)} = 1`),
  );
});

it('partitions every source turn exactly once as primary coverage without tail loss', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: 'First turn.' },
        { speaker: 'Them', text: 'Second turn.' },
        { speaker: 'Me', text: 'Final commitment must remain covered.' },
      ],
    }),
  );
  const leaves = partitionNotesSource(source, (packet) => packet.length <= 80);

  expect(leaves.flatMap((leaf) => leaf.primarySpans)).toEqual([
    { segment: 0, start: 0, end: source.segments[0]?.text.length },
    { segment: 1, start: 0, end: source.segments[1]?.text.length },
    { segment: 2, start: 0, end: source.segments[2]?.text.length },
  ]);
  expect(leaves.at(-1)?.primaryText).toContain('Final commitment');
});

it('splits a long Unicode turn on code-point boundaries when one turn exceeds capacity', () => {
  const text = 'Plan 👍 today and review tomorrow.';
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text }] }),
  );
  const leaves = partitionNotesSource(source, (packet) => packet.length <= 12);

  expect(leaves.flatMap((leaf) => leaf.primarySpans)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ segment: 0, start: 0 }),
      expect.objectContaining({ segment: 0, end: text.length }),
    ]),
  );
  expect(leaves.every((leaf) => leaf.primaryText.length > 0)).toBe(true);
});

it.each([
  { text: 'abc😀!', capacity: 4 },
  { text: '😀😀😀!', capacity: 2 },
  { text: 'a😀b🚀c👍!', capacity: 3 },
  { text: 'abc😀!🚀👍', capacity: 4 },
])(
  'terminates and preserves Unicode source $text at capacity $capacity',
  ({ text, capacity }) => {
    const source = createNotesSource(JSON.stringify({ segments: [{ text }] }));
    let budgetChecks = 0;
    const leaves = partitionNotesSource(source, (packet) => {
      // A synchronous loop cannot be stopped by Vitest's test timeout.
      if (++budgetChecks > 1000)
        throw new Error('Source partitioning did not terminate');
      return packet.length <= capacity;
    });

    let covered = 0;
    const fragments = leaves.flatMap((leaf) =>
      leaf.primarySpans.map((span) => {
        expect(span.segment).toBe(0);
        expect(span.start).toBe(covered);
        expect(span.end).toBeGreaterThan(span.start);
        covered = span.end;
        const fragment = text.slice(span.start, span.end);
        expect(fragment).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
        return fragment;
      }),
    );
    expect(fragments.join('')).toBe(text);
    expect(covered).toBe(text.length);
    expect(leaves.every((leaf) => leaf.sourceText.length <= capacity)).toBe(
      true,
    );
  },
);

it('fails explicitly when fixed prompt content cannot fit any source window', () => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text: 'Keep this.' }] }),
  );

  expect(() => partitionNotesSource(source, () => false)).toThrow(
    'notes_context_exhausted',
  );
});

it('adds at most one fitting prior utterance as supplemental overlap', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: 'A' },
        { speaker: 'Me', text: 'B' },
        { speaker: 'Me', text: 'C' },
      ],
    }),
  );

  const leaves = partitionNotesSource(source, (packet) => packet.length <= 3);

  expect(leaves).toHaveLength(2);
  expect(leaves[1]?.primaryText).toBe('C');
  expect(leaves[1]?.overlapSpans).toEqual([{ segment: 1, start: 0, end: 1 }]);
  expect(leaves[1]?.sourceText).toBe('B\nC');
});
