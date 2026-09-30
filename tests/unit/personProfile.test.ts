import { describe, expect, it } from 'vitest';
import {
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
