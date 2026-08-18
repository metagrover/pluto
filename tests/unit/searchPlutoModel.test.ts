import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import { buildSearchPlutoResults } from '../../src/components/overlays/searchPlutoModel';
import type { Meeting } from '../../src/types';

const makeMeeting = (overrides: Partial<Meeting>): Meeting => ({
  id: 'meeting-1',
  title: 'Launch Review',
  created_at: '2026-08-01T10:00:00.000Z',
  started_at: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const makeEntity = (overrides: Partial<Entity>): Entity => ({
  id: 'entity-1',
  type: 'project',
  name: 'Launch Project',
  normalized_name: 'launch project',
  status: 'active',
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'general',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

describe('buildSearchPlutoResults', () => {
  it('groups project, people, and meeting results while excluding unsupported entity types', () => {
    const results = buildSearchPlutoResults({
      query: 'launch',
      meetings: [
        makeMeeting({
          id: 'meeting-launch',
          title: 'Launch Readiness',
          enhanced_notes: 'Customer rollout status.',
        }),
        makeMeeting({
          id: 'meeting-other',
          title: 'Hiring Sync',
          enhanced_notes: 'No matching text.',
        }),
      ],
      entities: [
        makeEntity({
          id: 'project-launch',
          type: 'project',
          name: 'Launch Project',
        }),
        makeEntity({
          id: 'person-launch',
          type: 'person',
          name: 'Launch Partner',
        }),
        makeEntity({
          id: 'topic-launch',
          type: 'topic',
          name: 'Launch Topic',
        }),
      ],
    });

    expect(results.map((result) => [result.kind, result.title])).toEqual([
      ['project', 'Launch Project'],
      ['person', 'Launch Partner'],
      ['meeting', 'Launch Readiness'],
    ]);
  });

  it('returns no results for blank search text', () => {
    expect(
      buildSearchPlutoResults({
        query: '   ',
        meetings: [makeMeeting({ title: 'Launch Readiness' })],
        entities: [makeEntity({ name: 'Launch Project' })],
      }),
    ).toEqual([]);
  });

  it('sorts matching results by latest creation time within each result type', () => {
    const results = buildSearchPlutoResults({
      query: 'launch',
      meetings: [
        makeMeeting({
          id: 'meeting-old',
          title: 'Launch Planning',
          created_at: '2026-08-01T10:00:00.000Z',
          started_at: '2026-08-01T10:00:00.000Z',
        }),
        makeMeeting({
          id: 'meeting-new',
          title: 'Launch Follow-up',
          created_at: '2026-08-03T10:00:00.000Z',
          started_at: '2026-08-03T10:00:00.000Z',
        }),
      ],
      entities: [
        makeEntity({
          id: 'project-old',
          type: 'project',
          name: 'Launch Alpha',
          created_at: '2026-08-01T10:00:00.000Z',
        }),
        makeEntity({
          id: 'project-new',
          type: 'project',
          name: 'Launch Beta',
          created_at: '2026-08-04T10:00:00.000Z',
        }),
        makeEntity({
          id: 'person-old',
          type: 'person',
          name: 'Launch Partner A',
          created_at: '2026-08-02T10:00:00.000Z',
        }),
        makeEntity({
          id: 'person-new',
          type: 'person',
          name: 'Launch Partner B',
          created_at: '2026-08-05T10:00:00.000Z',
        }),
      ],
    });

    expect(results.map((result) => result.id)).toEqual([
      'project-new',
      'project-old',
      'person-new',
      'person-old',
      'meeting-new',
      'meeting-old',
    ]);
  });

  it('filters project and person entities by the search query', () => {
    const results = buildSearchPlutoResults({
      query: 'launch',
      meetings: [],
      entities: [
        makeEntity({
          id: 'project-launch',
          type: 'project',
          name: 'Launch Project',
        }),
        makeEntity({
          id: 'project-hiring',
          type: 'project',
          name: 'Hiring Plan',
          normalized_name: 'hiring plan',
        }),
        makeEntity({
          id: 'person-launch',
          type: 'person',
          name: 'Launch Partner',
        }),
        makeEntity({
          id: 'person-finance',
          type: 'person',
          name: 'Finley Ops',
          normalized_name: 'finley ops',
        }),
      ],
    });

    expect(results.map((result) => result.id)).toEqual([
      'project-launch',
      'person-launch',
    ]);
  });

  it('caps Search Pluto results to a bounded set', () => {
    const results = buildSearchPlutoResults({
      query: 'launch',
      meetings: Array.from({ length: 12 }, (_, index) =>
        makeMeeting({
          id: `meeting-${index}`,
          title: `Launch Meeting ${index}`,
          created_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
          started_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
        }),
      ),
      entities: [
        ...Array.from({ length: 12 }, (_, index) =>
          makeEntity({
            id: `project-${index}`,
            type: 'project' as const,
            name: `Launch Project ${index}`,
            created_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
            updated_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
          }),
        ),
        ...Array.from({ length: 12 }, (_, index) =>
          makeEntity({
            id: `person-${index}`,
            type: 'person' as const,
            name: `Launch Person ${index}`,
            created_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
            updated_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
          }),
        ),
      ],
    });

    expect(results).toHaveLength(15);
    expect(results.filter((result) => result.kind === 'project')).toHaveLength(
      5,
    );
    expect(results.filter((result) => result.kind === 'person')).toHaveLength(
      5,
    );
    expect(results.filter((result) => result.kind === 'meeting')).toHaveLength(
      5,
    );
  });
});
