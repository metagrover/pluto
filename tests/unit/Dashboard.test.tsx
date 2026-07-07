import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { Entity } from '../../src/api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../src/api/knowledgeWorkspace';
import { Dashboard } from '../../src/components/features/Dashboard';
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

const makeAttentionItem = (
  overrides: Partial<AttentionItem> = {},
): AttentionItem => ({
  id: 'attention-1',
  dedupe_key: 'action_tracker:overdue:action-1',
  kind: 'follow_up',
  severity: 'watch',
  score: 0.42,
  status: 'active',
  title: 'Review indexing rollout',
  reason: 'This follow-up still needs attention.',
  source: 'action_tracker',
  score_breakdown: null,
  evidence: [],
  related_entity_ids: ['action-1'],
  related_stream_ids: [],
  related_meeting_ids: [],
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  last_seen_at: '2026-04-25T10:00:00.000Z',
  resolved_at: null,
  ...overrides,
});

const makeDoc = (overrides: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'doc-1',
  scope_type: 'project',
  scope_key: 'project-1',
  title: 'Indexing Rollout',
  rendered_content: null,
  structured_json: JSON.stringify({
    schema_version: 2,
    scope: { type: 'project', title: 'Indexing Rollout' },
    current_read: {
      headline: 'Search indexing is converging around the rollout plan.',
      trust_message: 'Grounded in direct meeting evidence.',
      evidence_quality: {
        mode: 'direct',
        confidence: 0.9,
        cited_meeting_count: 3,
        source_count: 4,
        last_reinforced_at: '2026-04-27T16:00:00.000Z',
        freshness: 'fresh',
      },
      source_count: 4,
      cited_item_count: 3,
      cited_meeting_count: 3,
      freshness: 'fresh',
    },
    active_streams: [],
    needs_attention: [],
    patterns: [],
    risks_and_unknowns: [],
    evidence_index: [],
    source_quality_summary: {
      included_count: 4,
      excluded_count: 0,
      weak_count: 0,
      records: [],
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

describe('Dashboard', () => {
  it('renders blocker context on visible follow-up cards when the linked attention item carries it', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [
        makeAction({
          id: 'action-blocked',
          name: 'Finalize launch checklist',
        }),
      ],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [
        makeAttentionItem({
          id: 'attention-blocked',
          kind: 'blocker',
          title: 'Finalize launch checklist',
          reason: 'Blocked by legal approval.',
          related_entity_ids: ['action-blocked'],
        }),
      ],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    const markup = renderToStaticMarkup(
      <Dashboard
        model={model}
        loading={false}
        isRecording={false}
        setSelectedMeetingId={vi.fn()}
        setActiveTab={vi.fn()}
        setAskPlutoVisible={vi.fn()}
        updatingTaskIds={new Set()}
        actionError={null}
        handleCompleteTask={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('Blocker');
    expect(markup).toContain('Blocked by legal approval.');
  });
});
