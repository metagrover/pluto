import { describe, expect, it } from 'vitest';
import { selectProjectReviewSources } from '../../electron/projectScopeEvidence';

const filler =
  'The calendar invitation was updated for the next team meeting. ';

describe('project scope source evidence selection', () => {
  it('retains older strategy evidence across many recent low-information mentions', () => {
    const strategy =
      'Hyper personalization will give each account an individual experience. We will collect preference signals, build a recommendation service, and measure the pilot before rolling it out to all customers.';
    const sources = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `recent-${index}`,
        text: `Hyper-personalization work was mentioned in update ${index}.`,
      })),
      {
        id: 'older-strategy',
        text: filler.repeat(70) + strategy + filler.repeat(160),
      },
    ];
    const result = selectProjectReviewSources(
      sources,
      'hyper-personalization work',
    );
    expect(
      result.find((source) => source.id === 'older-strategy')?.text,
    ).toContain(strategy);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('finds partial names and lexical variants away from head, middle, and tail', () => {
    const outcome =
      'Deep research should become part of the customer journey. First collect the external sources and validate their provenance. Then build the research report and connect it to the delivery flow.';
    const strategy =
      'The hyper-personalisation launch needs preference collection and a recommendation service. The customer should receive an individual experience.';
    const sources = [
      {
        id: 'research',
        text: filler.repeat(90) + outcome + filler.repeat(300),
      },
      {
        id: 'personal',
        text: filler.repeat(90) + strategy + filler.repeat(300),
      },
    ];
    expect(
      selectProjectReviewSources(
        sources,
        'Deep research integration into existing pipeline',
      )[0].text,
    ).toContain(outcome);
    expect(
      selectProjectReviewSources(sources, 'Hyper personalization work')[0].text,
    ).toContain(strategy);
  });

  it('uses the full transcript when a caller also supplied an incomplete excerpt', () => {
    const fullText = `${filler.repeat(60)}Aurora replaces billing with account migration and new invoices.${filler.repeat(180)}`;
    const result = selectProjectReviewSources(
      [
        {
          id: 'original-id',
          text: 'A previous excerpt missed everything.',
          fullText,
        },
      ],
      'Aurora',
    );
    expect(result[0]).toMatchObject({ id: 'original-id', fullText });
    expect(result[0].text).toContain('Aurora replaces billing');
  });

  it('spends the available source budget on context around a single relevant passage', () => {
    const work =
      'Then migrate all accounts and release the new invoice service.';
    const text = `${filler.repeat(80)}Aurora replaces billing. ${filler.repeat(20)}${work}${filler.repeat(150)}`;
    const result = selectProjectReviewSources(
      [
        { id: 'strategy', text },
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `mention-${index}`,
          text: 'Aurora update.',
        })),
      ],
      'Aurora',
    );
    expect(result.find((source) => source.id === 'strategy')?.text).toContain(
      work,
    );
  });

  it('bounds evidence across sources, preserves contiguous fragments, and is deterministic', () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      text: `${filler.repeat(50)}Aurora source ${index}: preserve punctuation, $35, negations and corrections. ${filler.repeat(50)}Aurora needs customer migration. ${filler.repeat(100)}Aurora must not ship without invoice tests. ${filler.repeat(100)}`,
    }));
    const result = selectProjectReviewSources(sources, 'Aurora');
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(4);
    expect(
      result.reduce((total, source) => total + source.text.length, 0),
    ).toBeLessThanOrEqual(12000);
    for (const source of result) {
      const original = sources.find((item) => item.id === source.id)!;
      expect(source.fullText).toBe(original.text);
      for (const fragment of source.text.split('\n[excerpt break]\n')) {
        expect(fragment.length).toBeGreaterThan(0);
        expect(original.text).toContain(fragment);
      }
    }
    expect(selectProjectReviewSources(sources, 'Aurora')).toEqual(result);
  });

  it('handles empty sources and retains bounded context when no name matches', () => {
    expect(selectProjectReviewSources([], 'Aurora')).toEqual([]);
    expect(
      selectProjectReviewSources([{ id: 'empty', text: '  ' }], 'Aurora'),
    ).toEqual([]);
    const text = `Opening context. ${filler.repeat(120)}Middle context. ${filler.repeat(120)}Closing context.`;
    for (const name of ['', 'Unmentioned name']) {
      const result = selectProjectReviewSources(
        [{ id: 'fallback', text }],
        name,
      );
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Opening context.');
      expect(result[0].text).toContain('Middle context.');
      expect(result[0].text).toContain('Closing context.');
      expect(result[0].text.length).toBeLessThanOrEqual(12000);
    }
  });
});

it('bounds the serialized evidence payload even when transcript text needs JSON escaping', () => {
  const text = `${'a"\\'.repeat(5000)} Aurora outcome with migration and invoice work. ${'b"\\'.repeat(5000)}`;
  const selected = selectProjectReviewSources(
    [{ id: 'escaped', text }],
    'Aurora',
  );
  const payload = JSON.stringify(
    selected.map((source) => ({ id: source.id, text: source.text })),
  );
  expect(payload.length).toBeLessThanOrEqual(12000);
  expect(selected[0].text).toContain(
    'Aurora outcome with migration and invoice work.',
  );
});

it('supports a smaller routing budget while retaining relevant evidence', () => {
  const sources = Array.from({ length: 6 }, (_, index) => ({
    id: `source-${index}`,
    text: `${'Routine context. '.repeat(300)} Archive permission validation continues the searchable collection pilot. ${'Closing context. '.repeat(300)}`,
  }));
  const selected = selectProjectReviewSources(
    sources,
    'Archive permission validation',
    { maxSources: 2, maxChars: 2000 },
  );
  expect(selected).toHaveLength(2);
  expect(
    JSON.stringify(selected.map(({ id, text }) => ({ id, text }))).length,
  ).toBeLessThanOrEqual(2000);
  expect(
    selected.every((source) =>
      source.text.includes('Archive permission validation continues'),
    ),
  ).toBe(true);
});
