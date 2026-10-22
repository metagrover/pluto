import { describe, expect, it } from 'vitest';
import {
  mergePersonProfiles,
  parsePersonProfile,
  readPersonProfile,
} from '../../src/utils/personProfile';

const claim = {
  section: 'overview',
  summary: 'Avery requested a written recommendation.',
  citations: [
    {
      meeting_id: 'meeting-1',
      quote: 'Avery requested a written recommendation.',
    },
  ],
};

describe('person profile read boundary', () => {
  it('merges duplicate claims without losing later chunk citations or exceeding the citation cap', () => {
    const result = mergePersonProfiles(
      Array.from({ length: 6 }, (_, index) => ({
        ...claim,
        citations: [{ ...claim.citations[0], meeting_id: `meeting-${index}` }],
      })),
    );
    expect(result).toHaveLength(1);
    expect(result[0].citations.map((source) => source.meeting_id)).toEqual([
      'meeting-0',
      'meeting-1',
      'meeting-2',
      'meeting-3',
    ]);
    expect(claim.citations).toHaveLength(1);
  });

  it('omits malformed, unknown, uncited, oversized, and duplicate claims', () => {
    expect(
      parsePersonProfile([
        null,
        { ...claim, section: 'toString' },
        { ...claim, citations: [] },
        { ...claim, summary: 'x'.repeat(1401) },
        claim,
        claim,
      ]),
    ).toHaveLength(1);
    expect(readPersonProfile('not JSON')).toEqual([]);
    expect(
      parsePersonProfile([
        { ...claim, citations: [...claim.citations, { meeting_id: 'broken' }] },
      ]),
    ).toEqual([]);
    expect(
      readPersonProfile(JSON.stringify({ person_profile: [claim] })),
    ).toEqual([]);
    expect(
      readPersonProfile(
        JSON.stringify({
          evidence_index: [
            { meeting_id: 'meeting-1', quote: claim.citations[0].quote },
          ],
          person_profile: [
            {
              ...claim,
              citations: [
                ...claim.citations,
                {
                  meeting_id: 'missing',
                  quote: 'Avery has a different responsibility.',
                },
              ],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
  it('shows only profile claims whose exact citations remain in the grounded evidence index', () => {
    const doc = {
      person_profile: [claim],
      evidence_index: [
        { meeting_id: 'meeting-1', quote: claim.citations[0].quote },
      ],
    };
    expect(readPersonProfile(JSON.stringify(doc))).toHaveLength(1);
    expect(
      readPersonProfile(
        JSON.stringify({
          ...doc,
          evidence_index: [
            { meeting_id: 'other', quote: claim.citations[0].quote },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

it('keeps tentative or unclear timing out of urgent priorities without inventing a date', () => {
  const result = parsePersonProfile([
    {
      ...claim,
      section: 'priorities',
      title: 'Urgent delivery',
      summary: "Avery suggested a 'maybe lavender' deadline.",
    },
  ]);
  expect(result[0]).toMatchObject({
    section: 'unknowns',
    title: 'Timing needs clarification',
  });
  expect(result[0].summary).toContain('Timing is unconfirmed.');
  expect(result[0].citations).toEqual(claim.citations);
  expect(
    parsePersonProfile([
      {
        ...claim,
        section: 'priorities',
        summary: 'Avery confirmed a Friday deadline.',
      },
    ])[0].section,
  ).toBe('priorities');
});
