import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
import type { Entity } from '../../src/api/knowledgeGraph';
import { Dashboard } from '../../src/components/features/Dashboard';
import { buildDashboardHomeModel } from '../../src/components/features/dashboardModel';
import type { Meeting } from '../../src/types';

const makeMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  title: 'Launch Review',
  created_at: '2026-04-27T18:00:00.000Z',
  started_at: '2026-04-27T17:30:00.000Z',
  enhanced_notes: 'We reviewed launch readiness and approvals.',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'Launch readiness now depends on privacy review.',
  }),
  ...overrides,
});

const makeAction = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'action-1',
  type: 'action_item',
  name: 'Ship privacy review',
  normalized_name: 'ship privacy review',
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
  title: 'Ship privacy review',
  reason: 'This follow-up still needs attention.',
  source: 'action_tracker',
  score_breakdown: null,
  evidence: [],
  related_entity_ids: ['action-1'],
  related_stream_ids: [],
  related_meeting_ids: ['meeting-1'],
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  last_seen_at: '2026-04-25T10:00:00.000Z',
  resolved_at: null,
  ...overrides,
});

describe('Dashboard', () => {
  it('renders linked meeting context on follow-up cards when available', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction()],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [makeAttentionItem()],
      workspace: null,
      graphStats: null,
    });

    const markup = renderToStaticMarkup(
      <Dashboard
        model={model}
        loading={false}
        isRecording={false}
        setSelectedMeetingId={() => {}}
        setActiveTab={() => {}}
        setAskPlutoVisible={() => {}}
        updatingTaskIds={new Set()}
        actionError={null}
        handleCompleteTask={async () => {}}
      />,
    );

    expect(markup).toContain('Ship privacy review');
    expect(markup).toContain('Due Apr 26 · Launch Review');
    expect(markup).not.toContain('Due Apr 26 · Work');
  });
});
