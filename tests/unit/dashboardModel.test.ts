import { describe, expect, it } from 'vitest';

import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { Entity } from '../../src/api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../src/api/knowledgeWorkspace';
import { buildDashboardHomeModel } from '../../src/components/features/dashboardModel';
import type { Meeting } from '../../src/types';

const makeMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  title: 'Architecture Review',
  created_at: '2026-04-27T18:00:00.000Z',
  started_at: '2026-04-27T17:30:00.000Z',
  enhanced_notes: 'We reviewed indexing rollout risks.',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'Indexing rollout is close, with launch risk around review.',
  }),
  ...overrides,
});

const makeAction = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'action-1',
  type: 'action_item',
  name: 'Review indexing rollout',
  normalized_name: 'review indexing rollout',
  status: 'active',
  due_date: '2026-04-26T12:00:00.000Z',
  assigned_to: null,
  metadata: null,
  saliency_score: 0.8,
  domain_tag: 'work',
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeDoc = (overrides: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'doc-1',
  scope_type: 'project',
  scope_key: 'project-1',
  title: 'Indexing Rollout',
  rendered_content: null,
  structured_json: JSON.stringify({
    current_read: {
      headline: 'Search indexing is converging around the rollout plan.',
      source_count: 4,
    },
  }),
  config: null,
  status: 'up_to_date',
  last_synthesized_at: '2026-04-27T16:00:00.000Z',
  last_source_cursor: null,
  updated_at: '2026-04-27T16:00:00.000Z',
  ...overrides,
});

const makeProjectCard = (
  overrides: Partial<KnowledgeProjectHealthCard> = {},
): KnowledgeProjectHealthCard => ({
  doc_id: 'doc-1',
  project_id: 'project-1',
  title: 'Indexing Rollout',
  open_blockers: 1,
  dependency_count: 2,
  recent_changes: 3,
  staleness_days: 0,
  ...overrides,
});

const makeWorkspace = (
  overrides: Partial<KnowledgeWorkspacePayload> = {},
): KnowledgeWorkspacePayload => ({
  docs: [makeDoc()],
  selected_doc: makeDoc(),
  notes: null,
  graph: { nodes: [], edges: [] },
  timeline: [],
  backlinks: [],
  project_cards: [makeProjectCard()],
  ...overrides,
});

describe('buildDashboardHomeModel', () => {
  it('prioritizes an overdue action over the latest meeting in the hero', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ name: 'Ship privacy review' })],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('overdue_action');
    expect(model.hero.title).toBe('1 overdue item');
    expect(model.hero.detail).toContain('Ship privacy review');
    expect(model.hero.action?.target).toBe('projects');
  });

  it('uses a stale action when there are no overdue actions', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [makeAction({ name: 'Revisit launch blockers' })],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('stale_action');
    expect(model.hero.detail).toContain('Revisit launch blockers');
  });

  it('falls back cleanly when no real data exists', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });

    expect(model.hero.kind).toBe('default');
    expect(model.latestMeeting.state).toBe('empty');
    expect(model.actionInsights.state).toBe('empty');
    expect(model.knowledgeDocuments.state).toBe('empty');
    expect(model.spotlight).toBeNull();
  });
});
