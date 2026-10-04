import { describe, expect, it } from 'vitest';
import {
  balanceProjectNoteContexts,
  combineProjectFacetContext,
  findExplicitProjectScopes,
  getProjectFacetKeywords,
  restrictEvidenceToMeetingIds,
} from '../../electron/intelligence/askPlutoProjectScopes';
import type { RetrievalResult } from '../../electron/intelligence/intelligenceTypes';

const projects = [
  {
    canonicalId: 'atlas',
    name: 'Project Atlas',
    displayTitle: 'Atlas release',
  },
  {
    canonicalId: 'beacon',
    name: 'Beacon intelligence',
    displayTitle: 'Beacon',
  },
  { canonicalId: 'atlas', name: 'Atlas legacy', displayTitle: 'Atlas release' },
];
const note = (id: string, text = id): RetrievalResult => ({
  meeting_id: id,
  meeting_title: id,
  evidence_text: text,
  evidence_kind: 'note',
  mid: null,
  score: 1,
  score_breakdown: {
    fts_rank: 1,
    graph_proximity: 0,
    recency_decay: 1,
    mention_weight: 0,
  },
});

describe('explicit project comparison scope', () => {
  it('keeps only the explicitly selected fictional meeting after supplementary merges', () => {
    const selected = {
      ...note('warehouse-review', 'May 4 packing review.'),
      source_revision: 'warehouse-v2',
    };
    expect(
      restrictEvidenceToMeetingIds(
        [
          note('orchard-review'),
          selected,
          {
            ...note(
              'warehouse-review',
              'Project snapshot from another period.',
            ),
            source_type: 'artifact',
          },
        ],
        ['warehouse-review'],
      ),
    ).toEqual([selected]);
  });
  it('preserves all and only the meetings resolved within a requested date range', () => {
    const may = [note('may-planning'), note('may-review')];
    expect(
      restrictEvidenceToMeetingIds(
        [note('april-review'), ...may, note('june-review')],
        ['may-planning', 'may-review'],
      ),
    ).toEqual(may);
    expect(restrictEvidenceToMeetingIds(may, [])).toEqual([]);
    expect(restrictEvidenceToMeetingIds(may)).toBe(may);
  });
  it.each([true, false])(
    'prefers current whole notes over same-revision section excerpts (note first: %s)',
    (noteFirst) => {
      const whole = {
        ...note(
          'warehouse',
          'Warehouse packing is due May 8. Morgan owns readiness.',
        ),
        source_revision: 'revision-2',
        retrieved_sections: [
          {
            section_id: 'packing',
            heading: 'Packing',
            kind: 'topic',
            summary: 'Packing readiness',
          },
        ],
      };
      const section = {
        ...note('warehouse', 'Warehouse packing is due May 8.'),
        source_revision: 'revision-2',
        evidence_kind: 'section' as const,
      };
      const result = balanceProjectNoteContexts(
        noteFirst ? [[whole], [section]] : [[section], [whole]],
      );
      expect(result).toEqual([whole]);
    },
  );
  it('retains complementary same-revision section evidence', () => {
    const section = (text: string) => ({
      ...note('warehouse', text),
      source_revision: 'revision-2',
      evidence_kind: 'section' as const,
    });
    const result = balanceProjectNoteContexts([
      [section('Packing owner Morgan.')],
      [section('Dispatch owner Taylor.')],
    ]);
    expect(result[0].evidence_text).toContain('Packing owner Morgan');
    expect(result[0].evidence_text).toContain('Dispatch owner Taylor');
  });
  it('does not manufacture two project scopes from one shared display label', () => {
    const duplicateLabels = [
      {
        canonicalId: 'unrelated',
        name: 'Orion Program',
        displayTitle: 'Orion',
      },
      { canonicalId: 'orion', name: 'Orion', displayTitle: 'Orion' },
    ];
    expect(
      findExplicitProjectScopes('What is next for Orion?', duplicateLabels).map(
        (project) => project.canonicalId,
      ),
    ).toEqual(['orion']);
    expect(
      findExplicitProjectScopes(
        'Compare Orion and Orion Program.',
        duplicateLabels,
      ),
    ).toHaveLength(2);
  });
  it('retains balanced supplemental sources beyond the former eight-source ceiling', () => {
    const primary = Array.from({ length: 8 }, (_, index) =>
      note(`primary-${index}`),
    );
    const supplemental = Array.from({ length: 12 }, (_, index) =>
      note(`facet-${index}`),
    );
    const result = combineProjectFacetContext(primary, supplemental);
    expect(result).toHaveLength(12);
    expect(
      result.filter((source) => source.meeting_id.startsWith('primary')),
    ).toHaveLength(6);
    expect(
      result.filter((source) => source.meeting_id.startsWith('facet')),
    ).toHaveLength(6);
    expect(result.some((source) => source.meeting_id === 'facet-5')).toBe(true);
    expect(combineProjectFacetContext([], supplemental)).toHaveLength(12);
  });
  it('removes only primary project labels and preserves substantive requested facets', () => {
    expect(
      getProjectFacetKeywords(
        ['Atlas', 'release', 'owners', 'Beacon', 'testing'],
        ['Project Atlas', 'Atlas release'],
      ),
    ).toEqual(['owners', 'Beacon', 'testing']);
    expect(
      getProjectFacetKeywords(
        [
          'delivery',
          'dependencies',
          'owners',
          'dates',
          'decisions',
          'blockers',
          'status',
        ],
        ['Project Atlas'],
      ),
    ).toEqual([
      'delivery',
      'dependencies',
      'owners',
      'dates',
      'decisions',
      'blockers',
      'status',
    ]);
  });
  it('uses the same bounded projection for route and diagnostic evidence', () => {
    const primary = Array.from({ length: 6 }, (_, index) =>
      note(`primary-${index}`),
    );
    const supplemental = [
      note('primary-0'),
      note('primary-1'),
      note('primary-2'),
      note('primary-3'),
      note('numeric-a', '15 designs, six tests'),
      note('numeric-b', 'five profiles, three commits'),
    ];
    const result = combineProjectFacetContext(primary, supplemental);
    expect(result).toHaveLength(8);
    expect(result.map((source) => source.meeting_id)).toContain('numeric-a');
    expect(result.map((source) => source.meeting_id)).toContain('numeric-b');
    expect(combineProjectFacetContext(primary, [])).toEqual(primary);
  });
  it('fills supplemental slots after early duplicate primary notes', () => {
    const primary = Array.from({ length: 6 }, (_, index) =>
      note(`primary-${index}`),
    );
    const supplemental = [
      note('primary-0', 'Additional requested facet in a shared meeting'),
      note('primary-1'),
      note('facet-weekly'),
      note('facet-design'),
      note('facet-next'),
      note('facet-review'),
    ];
    const result = balanceProjectNoteContexts([primary, supplemental]);
    expect(result).toHaveLength(10);
    expect(result.some((source) => source.meeting_id === 'facet-weekly')).toBe(
      true,
    );
    expect(result.some((source) => source.meeting_id === 'facet-design')).toBe(
      true,
    );
    expect(
      result.find((source) => source.meeting_id === 'primary-0')?.evidence_text,
    ).toContain('Additional requested facet');
  });
  it('keeps two named canonical workstreams distinct', () => {
    expect(
      findExplicitProjectScopes(
        'Compare Atlas release and Beacon intelligence.',
        projects,
      ).map((project) => project.canonicalId),
    ).toEqual(['atlas', 'beacon']);
  });
  it('keeps aliases of one project within one scope during a historical comparison', () => {
    expect(
      findExplicitProjectScopes(
        'Compare Project Atlas with Atlas legacy last month.',
        projects,
      ),
    ).toHaveLength(1);
  });
  it('rejects partial words and generic project labels', () => {
    expect(
      findExplicitProjectScopes('Compare Beacons and projects.', [
        ...projects,
        { canonicalId: 'generic', name: 'project', displayTitle: 'stream' },
      ]),
    ).toEqual([]);
  });
  it('includes evidence from both workstreams within twelve sources', () => {
    const groups = ['atlas', 'beacon'].map((project) =>
      Array.from({ length: 8 }, (_, index) =>
        note(`${project}-${index}`, `${project} owner/date ${index}`),
      ),
    );
    const result = balanceProjectNoteContexts(groups);
    expect(result).toHaveLength(12);
    expect(
      result.filter((source) => source.meeting_id.startsWith('atlas')),
    ).toHaveLength(6);
    expect(
      result.filter((source) => source.meeting_id.startsWith('beacon')),
    ).toHaveLength(6);
  });
  it('preserves both scoped sections from a shared meeting with one citation ID', () => {
    const result = balanceProjectNoteContexts([
      [note('weekly', 'Atlas owner Morgan, delivery May 1.')],
      [note('weekly', 'Beacon owner Taylor, delivery May 5.'), note('design')],
    ]);
    expect(result.map((source) => source.meeting_id)).toEqual([
      'weekly',
      'design',
    ]);
    expect(result[0].evidence_text).toContain('Atlas owner Morgan');
    expect(result[0].evidence_text).toContain('Beacon owner Taylor');
  });
  it('fills unused scope slots with notes while excluding stale project profiles', () => {
    expect(
      balanceProjectNoteContexts([
        [{ ...note('profile'), source_type: 'artifact' }, note('a')],
        Array.from({ length: 8 }, (_, index) => note(`b-${index}`)),
      ]),
    ).toHaveLength(9);
  });
});
