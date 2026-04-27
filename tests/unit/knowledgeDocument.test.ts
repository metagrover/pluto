import { describe, expect, it } from 'vitest';

import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { KnowledgeProjectHealthCard } from '../../src/api/knowledgeWorkspace';
import {
  compileActiveProjectRadar,
  compileKnowledgeBrief,
  deriveKnowledgeDigest,
  groupKnowledgeDocs,
  parseStructuredKnowledgeDoc,
} from '../../src/components/KnowledgeGraph/knowledgeDocument';

const makeDoc = (overrides: Partial<KnowledgeDoc>): KnowledgeDoc => ({
  id: 'doc-1',
  scope_type: 'global',
  scope_key: 'global',
  title: 'Global Knowledge Context',
  rendered_content: null,
  structured_json: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: '2026-04-25T10:00:00.000Z',
  last_source_cursor: null,
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeProjectCard = (
  overrides: Partial<KnowledgeProjectHealthCard>,
): KnowledgeProjectHealthCard => ({
  doc_id: 'doc-project',
  project_id: 'project-1',
  title: 'Project One',
  open_blockers: 0,
  dependency_count: 0,
  recent_changes: 0,
  staleness_days: 0,
  ...overrides,
});

describe('knowledge document utilities', () => {
  it('parses structured knowledge chapters and citations', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Use the citation-backed knowledge document as the main memory surface.',
                why_it_matters:
                  'It keeps browsing grounded in meeting evidence.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote: 'make the knowledge docs the main surface',
                  },
                ],
              },
            ],
            topic_evolution: [],
            open_risks: [],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const parsed = parseStructuredKnowledgeDoc(doc);

    expect(parsed?.chapters[0].decisions[0]).toMatchObject({
      id: 'd1',
      text: 'Use the citation-backed knowledge document as the main memory surface.',
      citations: [
        {
          meeting_id: 'm1',
          quote: 'make the knowledge docs the main surface',
        },
      ],
    });
  });

  it('returns null for missing or malformed structured JSON', () => {
    expect(
      parseStructuredKnowledgeDoc(makeDoc({ structured_json: null })),
    ).toBe(null);
    expect(
      parseStructuredKnowledgeDoc(makeDoc({ structured_json: '{not json' })),
    ).toBe(null);
  });

  it('derives digest items from structured sections before rendered fallback', () => {
    const doc = makeDoc({
      rendered_content: 'Rendered fallback should not be first.',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Decision one is important.',
                why_it_matters: 'It changes the product direction.',
                citations: [],
              },
            ],
            topic_evolution: [
              {
                id: 't1',
                text: 'The knowledge surface is shifting toward synthesized docs.',
                why_it_matters:
                  'The old dashboard over-emphasized graph entities.',
                citations: [],
              },
            ],
            open_risks: [],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    expect(deriveKnowledgeDigest(doc)).toEqual([
      'Decision one is important.',
      'The knowledge surface is shifting toward synthesized docs.',
    ]);
  });

  it('falls back to rendered content when structured data is unavailable', () => {
    const doc = makeDoc({
      rendered_content:
        '# Global Knowledge Context\n\nAuto-synthesized yesterday.\n\n- First useful memory.\n- Second useful memory.',
    });

    expect(deriveKnowledgeDigest(doc)).toEqual([
      'First useful memory.',
      'Second useful memory.',
    ]);
  });

  it('groups docs by scope for the browser', () => {
    const groups = groupKnowledgeDocs([
      makeDoc({ id: 'global', scope_type: 'global', title: 'Global' }),
      makeDoc({ id: 'project', scope_type: 'project', title: 'Project' }),
      makeDoc({
        id: 'person',
        scope_type: 'person_context',
        title: 'Person',
      }),
      makeDoc({ id: 'team', scope_type: 'team_tracker', title: 'Team' }),
    ]);

    expect(groups.map((group) => [group.scopeType, group.docs.length])).toEqual(
      [
        ['global', 1],
        ['project', 1],
        ['person_context', 1],
        ['team_tracker', 1],
      ],
    );
  });

  it('compiles a brief with priority, risk, pattern, and dependency lanes', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Prioritize the active project intelligence surface.',
                why_it_matters: 'It turns memory into a daily planning input.',
                citations: [],
              },
            ],
            topic_evolution: [
              {
                id: 't1',
                text: 'Knowledge moved from archive browsing to signal synthesis.',
                why_it_matters: 'The interface should feel compiled.',
                citations: [],
              },
            ],
            open_risks: [
              {
                id: 'r1',
                text: 'A document-first view can bury urgent project risks.',
                why_it_matters:
                  'Risk should be visible before evidence drilldown.',
                citations: [],
              },
            ],
            signals: [
              {
                id: 's1',
                text: 'Repeated reviews mention overwhelm and weak prioritization.',
                why_it_matters: 'Pluto should reduce interpretation work.',
                citations: [],
              },
            ],
          },
        ],
        dependency_suggestions: [
          {
            source_name: 'Knowledge Home',
            target_name: 'Projects',
            relationship: 'impacts',
            why: 'Project context should feed the compiled brief.',
            citations: [],
          },
        ],
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(true);
    expect(brief.headline).toBe(
      'Repeated reviews mention overwhelm and weak prioritization.',
    );
    expect(brief.lanes.map((lane) => lane.id)).toEqual([
      'priorities',
      'risks',
      'patterns',
      'dependencies',
    ]);
    expect(brief.lanes[0].items[0].text).toBe(
      'Repeated reviews mention overwhelm and weak prioritization.',
    );
    expect(brief.lanes[1].items[0].text).toBe(
      'A document-first view can bury urgent project risks.',
    );
    expect(brief.lanes[3].items[0].text).toBe(
      'Knowledge Home impacts Projects',
    );
  });

  it('marks unstructured documents as not compiled instead of inventing claims', () => {
    const brief = compileKnowledgeBrief(
      makeDoc({
        title: 'Preview Memory',
        rendered_content:
          '# Preview Memory\n\nSignals will appear after Electron provides real knowledge data.',
        structured_json: null,
      }),
    );

    expect(brief.isCompiled).toBe(false);
    expect(brief.headline).toBe('No reliable compiled brief yet.');
    expect(brief.lanes.every((lane) => lane.items.length === 0)).toBe(true);
  });

  it('compiles active project radar from project health and doc status', () => {
    const radar = compileActiveProjectRadar(
      [
        makeDoc({
          id: 'doc-blocked',
          scope_type: 'project',
          title: 'Blocked Launch',
          status: 'up_to_date',
        }),
        makeDoc({
          id: 'doc-stale',
          scope_type: 'project',
          title: 'Stale Migration',
          status: 'stale',
        }),
      ],
      [
        makeProjectCard({
          doc_id: 'doc-blocked',
          title: 'Blocked Launch',
          open_blockers: 2,
          dependency_count: 1,
          recent_changes: 3,
          staleness_days: 1,
        }),
        makeProjectCard({
          doc_id: 'doc-stale',
          title: 'Stale Migration',
          open_blockers: 0,
          dependency_count: 0,
          recent_changes: 0,
          staleness_days: 12,
        }),
      ],
    );

    expect(radar.map((item) => item.title)).toEqual([
      'Blocked Launch',
      'Stale Migration',
    ]);
    expect(radar[0]).toMatchObject({
      severity: 'critical',
      label: 'Needs attention',
    });
    expect(radar[0].reasons).toContain('2 blockers');
    expect(radar[1]).toMatchObject({
      severity: 'watch',
      label: 'Getting stale',
    });
  });
});
