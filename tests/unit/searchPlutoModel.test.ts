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
});
