import { describe, expect, it } from 'vitest';

import type { WorkingMemorySnapshot } from '../../electron/db';
import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
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

const makeWorkingMemorySnapshot = (
  overrides: Partial<WorkingMemorySnapshot> = {},
): WorkingMemorySnapshot => ({
  id: 'snapshot-1',
  scope_type: 'global',
  scope_key: 'global',
  title: 'Workspace Memory',
  source_doc_id: 'doc-global',
  source_doc_last_synthesized_at: '2026-04-27T18:00:00.000Z',
  freshness: 'fresh',
  trust_status: 'inferred',
  source_count: 7,
  cited_meeting_count: 5,
  payload: {
    schema_version: 1,
    scope: {
      type: 'global',
      key: 'global',
      title: 'Workspace Memory',
    },
    source: {
      knowledge_doc_id: 'doc-global',
      knowledge_doc_last_synthesized_at: '2026-04-27T18:00:00.000Z',
    },
    current_read: {
      headline:
        'Working memory says launch readiness still depends on search signoff.',
      supporting_bullets: ['Search signoff is the gating dependency.'],
      freshness: 'fresh',
      trust_status: 'inferred',
      trust_message:
        'Synthesized from converging evidence across recent meetings.',
      source_count: 7,
      cited_meeting_count: 5,
    },
    active_streams: [],
    open_loops: [],
    patterns: [],
    risks_and_unknowns: [],
    evidence_index: [],
  },
  generated_at: '2026-04-27T18:00:00.000Z',
  updated_at: '2026-04-27T18:00:00.000Z',
  ...overrides,
});

describe('buildDashboardHomeModel', () => {
  it('exposes reviewed dashboard navigation targets from real model output', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [makeAction()],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.action?.target).toBe('meeting');
    expect(model.quickActions.map((action) => action.target)).toEqual([
      'ask',
      'meeting',
      'projects',
      'wiki',
    ]);
  });

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
    expect(model.hero.severity).toBe('urgent');
    expect(model.hero.detail).toContain('Ship privacy review');
    expect(model.hero.action?.target).toBe('projects');
    expect(model.briefingFocus).toMatchObject({
      kind: 'attention',
      title: 'Needs attention',
      detail: '1 overdue item',
      action: { label: 'Review actions', target: 'projects' },
    });
    expect(model.latestMeeting.state).toBe('populated');
    expect(model.actionInsights.state).toBe('populated');
    expect(model.actionInsights.items[0]).toMatchObject({
      id: 'action-1',
      title: 'Ship privacy review',
      dueLabel: 'Due Apr 26',
      status: 'overdue',
      sourceLabel: 'Work',
    });
    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      id: 'doc-1',
      title: 'Indexing Rollout',
      description: 'Search indexing is converging around the rollout plan.',
      countLabel: '1 blocker · 2 dependencies',
      status: 'up_to_date',
      scopeType: 'project',
      trustStatus: 'grounded',
      trustDescription: 'Backed by direct evidence from cited source material.',
    });
    expect(model.spotlight).toMatchObject({
      title: 'Indexing Rollout',
      subtitle: 'Project spotlight',
      detail: expect.stringContaining('1 blocker'),
      tags: ['1 blocker', '2 dependencies', '3 recent changes'],
      target: 'projects',
    });
    expect(model.quickActions).toEqual([
      { label: 'Ask Pluto', target: 'ask' },
      { label: 'Review latest', target: 'meeting', meetingId: 'meeting-1' },
      { label: 'Open projects', target: 'projects' },
      { label: 'Knowledge home', target: 'wiki' },
    ]);
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
    expect(model.hero.severity).toBe('watch');
    expect(model.hero.detail).toContain('Revisit launch blockers');
    expect(model.briefingFocus).toMatchObject({
      kind: 'attention',
      title: 'Needs attention',
      detail: '1 stale item',
      action: { label: 'Review actions', target: 'projects' },
    });
    expect(model.actionInsights.items[0]).toMatchObject({
      status: 'stale',
      sourceLabel: 'Work',
    });
  });

  it('suppresses dismissed linked follow-ups from dashboard attention lists', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ name: 'Ship privacy review' })],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [makeAttentionItem({ status: 'dismissed' })],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('latest_meeting');
    expect(model.briefingFocus.kind).toBe('latest_meeting');
    expect(model.actionInsights.state).toBe('empty');
  });

  it('suppresses snoozed linked follow-ups from dashboard attention lists', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [makeAction({ name: 'Revisit launch blockers' })],
      activeActions: [],
      attentionAlerts: [makeAttentionItem({ status: 'snoozed' })],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('latest_meeting');
    expect(model.briefingFocus.kind).toBe('latest_meeting');
    expect(model.actionInsights.state).toBe('empty');
  });

  it('keeps dashboard follow-ups visible when any linked alert is still active', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ name: 'Ship privacy review' })],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [
        makeAttentionItem({ id: 'attention-dismissed', status: 'dismissed' }),
        makeAttentionItem({ id: 'attention-active', status: 'active' }),
      ],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('overdue_action');
    expect(model.actionInsights.state).toBe('populated');
    expect(model.actionInsights.items[0]).toMatchObject({
      title: 'Ship privacy review',
      attentionItemId: 'attention-active',
      attentionStatus: 'active',
      dismissLabel: 'Dismiss',
      snoozeLabel: 'Snooze',
    });
  });

  it('uses the latest meeting as the briefing focus when no actions need attention', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.briefingFocus).toEqual({
      kind: 'latest_meeting',
      title: 'Latest meeting',
      detail: 'Indexing rollout is close, with launch risk around review.',
      action: {
        label: 'Open brief',
        target: 'meeting',
        meetingId: 'meeting-1',
      },
    });
  });

  it('uses knowledge as the briefing focus when only memory documents exist', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      workingMemorySnapshot: null,
      graphStats: null,
    });

    expect(model.briefingFocus).toEqual({
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail: 'Search indexing is converging around the rollout plan.',
      action: { label: 'Open knowledge', target: 'wiki' },
    });
  });

  it('prefers a matching working-memory snapshot for the global workspace memory card', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-global',
            scope_type: 'global',
            scope_key: 'global',
            title: 'Workspace Memory',
            last_synthesized_at: '2026-04-27T18:00:00.000Z',
            updated_at: '2026-04-27T18:00:00.000Z',
            structured_json: JSON.stringify({
              schema_version: 2,
              scope: { type: 'global', title: 'Workspace Memory' },
              current_read: {
                headline: 'Doc JSON says the old launch story.',
                trust_message: 'Grounded in direct meeting evidence.',
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.9,
                  cited_meeting_count: 2,
                  source_count: 3,
                  last_reinforced_at: '2026-04-27T16:00:00.000Z',
                  freshness: 'fresh',
                },
                source_count: 3,
                cited_item_count: 2,
                cited_meeting_count: 2,
                freshness: 'fresh',
              },
              active_streams: [],
              needs_attention: [],
              patterns: [],
              risks_and_unknowns: [],
              evidence_index: [],
              source_quality_summary: {
                included_count: 3,
                excluded_count: 0,
                weak_count: 0,
                records: [],
              },
            }),
          }),
        ],
        selected_doc: makeDoc({
          id: 'doc-global',
          scope_type: 'global',
          scope_key: 'global',
          title: 'Workspace Memory',
          last_synthesized_at: '2026-04-27T18:00:00.000Z',
          updated_at: '2026-04-27T18:00:00.000Z',
        }),
        project_cards: [],
      }),
      workingMemorySnapshot: makeWorkingMemorySnapshot(),
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      id: 'doc-global',
      title: 'Workspace Memory',
      description:
        'Working memory says launch readiness still depends on search signoff.',
      countLabel: '7 sources',
      trustStatus: 'inferred',
      trustDescription:
        'Supported by evidence, but synthesized across sources.',
    });
    expect(model.briefingFocus).toEqual({
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail:
        'Working memory says launch readiness still depends on search signoff.',
      action: { label: 'Open knowledge', target: 'wiki' },
    });
    expect(model.hero).toMatchObject({
      kind: 'knowledge_doc',
      title: 'Workspace Memory',
      detail:
        'Working memory says launch readiness still depends on search signoff.',
      action: { label: 'Knowledge home', target: 'wiki' },
    });
  });

  it('prefers a matching project working-memory snapshot for a dashboard project card', () => {
    const baseSnapshot = makeWorkingMemorySnapshot();
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-project',
            scope_type: 'project',
            scope_key: 'project-1',
            title: 'Project Atlas',
            structured_json: JSON.stringify({
              schema_version: 2,
              scope: { type: 'project', title: 'Project Atlas' },
              current_read: {
                headline: 'Doc JSON keeps the older project summary.',
                trust_message: 'Grounded in direct meeting evidence.',
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.9,
                  cited_meeting_count: 2,
                  source_count: 3,
                  last_reinforced_at: '2026-04-27T16:00:00.000Z',
                  freshness: 'fresh',
                },
                source_count: 3,
                cited_item_count: 2,
                cited_meeting_count: 2,
                freshness: 'fresh',
              },
              active_streams: [],
              needs_attention: [],
              patterns: [],
              risks_and_unknowns: [],
              evidence_index: [],
              source_quality_summary: {
                included_count: 3,
                excluded_count: 0,
                weak_count: 0,
                records: [],
              },
            }),
          }),
        ],
        project_cards: [
          makeProjectCard({
            doc_id: 'doc-project',
            project_id: 'project-1',
            title: 'Project Atlas',
          }),
        ],
      }),
      workingMemorySnapshots: [
        makeWorkingMemorySnapshot({
          id: 'snapshot-project',
          scope_type: 'project',
          scope_key: 'project-1',
          title: 'Project Atlas',
          source_doc_id: 'doc-project',
          source_doc_last_synthesized_at: '2026-04-27T16:00:00.000Z',
          payload: {
            ...baseSnapshot.payload,
            scope: {
              type: 'project',
              key: 'project-1',
              title: 'Project Atlas',
            },
            source: {
              knowledge_doc_id: 'doc-project',
              knowledge_doc_last_synthesized_at: '2026-04-27T16:00:00.000Z',
            },
            current_read: {
              ...baseSnapshot.payload.current_read,
              headline:
                'Working memory keeps the launch blocker visible for Project Atlas.',
            },
          },
        }),
      ],
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      id: 'doc-project',
      title: 'Project Atlas',
      description:
        'Working memory keeps the launch blocker visible for Project Atlas.',
      countLabel: '1 blocker · 2 dependencies',
      trustStatus: 'inferred',
      trustDescription:
        'Supported by evidence, but synthesized across sources.',
    });
    expect(model.briefingFocus).toEqual({
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail:
        'Working memory keeps the launch blocker visible for Project Atlas.',
      action: { label: 'Open knowledge', target: 'wiki' },
    });
    expect(model.hero).toMatchObject({
      kind: 'knowledge_doc',
      title: 'Project Atlas',
      detail:
        'Working memory keeps the launch blocker visible for Project Atlas.',
      action: { label: 'Knowledge home', target: 'wiki' },
    });
  });

  it('falls back to knowledge-doc data when the working-memory snapshot is stale', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-global',
            scope_type: 'global',
            scope_key: 'global',
            title: 'Workspace Memory',
            structured_json: JSON.stringify({
              schema_version: 2,
              scope: { type: 'global', title: 'Workspace Memory' },
              current_read: {
                headline: 'Doc JSON remains the trusted fallback.',
                trust_message: 'Grounded in direct meeting evidence.',
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.9,
                  cited_meeting_count: 2,
                  source_count: 3,
                  last_reinforced_at: '2026-04-27T16:00:00.000Z',
                  freshness: 'fresh',
                },
                source_count: 3,
                cited_item_count: 2,
                cited_meeting_count: 2,
                freshness: 'fresh',
              },
              active_streams: [],
              needs_attention: [],
              patterns: [],
              risks_and_unknowns: [],
              evidence_index: [],
              source_quality_summary: {
                included_count: 3,
                excluded_count: 0,
                weak_count: 0,
                records: [],
              },
            }),
          }),
        ],
        selected_doc: makeDoc({
          id: 'doc-global',
          scope_type: 'global',
          scope_key: 'global',
          title: 'Workspace Memory',
        }),
        project_cards: [],
      }),
      workingMemorySnapshot: makeWorkingMemorySnapshot({ freshness: 'stale' }),
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      description: 'Doc JSON remains the trusted fallback.',
      countLabel: '3 sources',
      trustStatus: 'grounded',
      trustDescription: 'Backed by direct evidence from cited source material.',
    });
    expect(model.briefingFocus).toEqual({
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail: 'Doc JSON remains the trusted fallback.',
      action: { label: 'Open knowledge', target: 'wiki' },
    });
  });

  it('falls back to project doc data when the matching project snapshot is stale', () => {
    const baseSnapshot = makeWorkingMemorySnapshot();
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-project',
            scope_type: 'project',
            scope_key: 'project-1',
            title: 'Project Atlas',
            structured_json: JSON.stringify({
              schema_version: 2,
              scope: { type: 'project', title: 'Project Atlas' },
              current_read: {
                headline: 'Doc JSON remains the trusted project fallback.',
                trust_message: 'Grounded in direct meeting evidence.',
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.9,
                  cited_meeting_count: 2,
                  source_count: 3,
                  last_reinforced_at: '2026-04-27T16:00:00.000Z',
                  freshness: 'fresh',
                },
                source_count: 3,
                cited_item_count: 2,
                cited_meeting_count: 2,
                freshness: 'fresh',
              },
              active_streams: [],
              needs_attention: [],
              patterns: [],
              risks_and_unknowns: [],
              evidence_index: [],
              source_quality_summary: {
                included_count: 3,
                excluded_count: 0,
                weak_count: 0,
                records: [],
              },
            }),
          }),
        ],
        project_cards: [
          makeProjectCard({
            doc_id: 'doc-project',
            project_id: 'project-1',
            title: 'Project Atlas',
          }),
        ],
      }),
      workingMemorySnapshots: [
        makeWorkingMemorySnapshot({
          id: 'snapshot-project',
          scope_type: 'project',
          scope_key: 'project-1',
          title: 'Project Atlas',
          source_doc_id: 'doc-project',
          freshness: 'stale',
          payload: {
            ...baseSnapshot.payload,
            scope: {
              type: 'project',
              key: 'project-1',
              title: 'Project Atlas',
            },
            source: {
              knowledge_doc_id: 'doc-project',
              knowledge_doc_last_synthesized_at: '2026-04-27T18:00:00.000Z',
            },
          },
        }),
      ],
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      description: 'Doc JSON remains the trusted project fallback.',
      countLabel: '1 blocker · 2 dependencies',
      trustStatus: 'grounded',
      trustDescription: 'Backed by direct evidence from cited source material.',
    });
  });

  it('falls back to knowledge-doc data when the working-memory snapshot is older than the doc synthesis', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-global',
            scope_type: 'global',
            scope_key: 'global',
            title: 'Workspace Memory',
            last_synthesized_at: '2026-04-28T09:00:00.000Z',
            updated_at: '2026-04-28T09:00:00.000Z',
            structured_json: JSON.stringify({
              schema_version: 2,
              scope: { type: 'global', title: 'Workspace Memory' },
              current_read: {
                headline: 'Doc JSON reflects the newest synthesis pass.',
                trust_message: 'Grounded in direct meeting evidence.',
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.9,
                  cited_meeting_count: 2,
                  source_count: 3,
                  last_reinforced_at: '2026-04-28T09:00:00.000Z',
                  freshness: 'fresh',
                },
                source_count: 3,
                cited_item_count: 2,
                cited_meeting_count: 2,
                freshness: 'fresh',
              },
              active_streams: [],
              needs_attention: [],
              patterns: [],
              risks_and_unknowns: [],
              evidence_index: [],
              source_quality_summary: {
                included_count: 3,
                excluded_count: 0,
                weak_count: 0,
                records: [],
              },
            }),
          }),
        ],
        selected_doc: makeDoc({
          id: 'doc-global',
          scope_type: 'global',
          scope_key: 'global',
          title: 'Workspace Memory',
          last_synthesized_at: '2026-04-28T09:00:00.000Z',
          updated_at: '2026-04-28T09:00:00.000Z',
        }),
        project_cards: [],
      }),
      workingMemorySnapshot: makeWorkingMemorySnapshot({
        source_doc_last_synthesized_at: '2026-04-27T18:00:00.000Z',
        generated_at: '2026-04-27T18:00:00.000Z',
        updated_at: '2026-04-27T18:00:00.000Z',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          source: {
            knowledge_doc_id: 'doc-global',
            knowledge_doc_last_synthesized_at: '2026-04-27T18:00:00.000Z',
          },
        },
      }),
      graphStats: null,
    });

    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      description: 'Doc JSON reflects the newest synthesis pass.',
      trustStatus: 'grounded',
      trustDescription: 'Backed by direct evidence from cited source material.',
    });
    expect(model.briefingFocus).toEqual({
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail: 'Doc JSON reflects the newest synthesis pass.',
      action: { label: 'Open knowledge', target: 'wiki' },
    });
  });

  it('does not promote zero-source preview knowledge docs into the briefing', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            title: 'Global Knowledge Context',
            status: 'inactive',
            structured_json: JSON.stringify({
              current_read: {
                headline: 'Preview Memory',
                source_count: 0,
              },
            }),
            rendered_content: 'Preview Memory',
          }),
        ],
        project_cards: [],
      }),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('default');
    expect(model.briefingFocus.kind).toBe('empty');
    expect(model.knowledgeDocuments.state).toBe('empty');
    expect(JSON.stringify(model)).not.toContain('Global Knowledge Context');
    expect(JSON.stringify(model)).not.toContain('Preview Memory');
  });

  it('deduplicates action insights by priority and caps displayed items', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [
        makeAction({ id: 'shared', name: 'Shared overdue task' }),
        makeAction({ id: 'overdue-2', name: 'Second overdue task' }),
      ],
      staleActions: [
        makeAction({ id: 'shared', name: 'Shared stale task' }),
        makeAction({ id: 'stale-1', name: 'First stale task' }),
        makeAction({ id: 'stale-2', name: 'Second stale task' }),
      ],
      activeActions: [
        makeAction({ id: 'shared', name: 'Shared active task' }),
        makeAction({ id: 'active-1', name: 'First active task' }),
        makeAction({ id: 'active-2', name: 'Second active task' }),
      ],
      workspace: null,
      graphStats: null,
    });

    expect(model.actionInsights.state).toBe('populated');
    expect(model.actionInsights.overdueCount).toBe(2);
    expect(model.actionInsights.staleCount).toBe(3);
    expect(model.actionInsights.activeCount).toBe(3);
    expect(model.actionInsights.items).toHaveLength(5);
    expect(model.actionInsights.items.map((item) => item.id)).toEqual([
      'overdue-2',
      'shared',
      'stale-1',
      'stale-2',
      'active-2',
    ]);
    expect(
      model.actionInsights.items.filter((item) => item.id === 'shared'),
    ).toEqual([
      expect.objectContaining({
        title: 'Shared overdue task',
        status: 'overdue',
      }),
    ]);
  });

  it('orders action insights by urgency, due date, and recency within each bucket', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [
        makeAction({
          id: 'overdue-later',
          name: 'Later overdue task',
          due_date: '2026-04-29T12:00:00.000Z',
          updated_at: '2026-04-29T18:00:00.000Z',
        }),
        makeAction({
          id: 'overdue-sooner',
          name: 'Sooner overdue task',
          due_date: '2026-04-20T12:00:00.000Z',
          updated_at: '2026-04-21T18:00:00.000Z',
        }),
      ],
      staleActions: [
        makeAction({
          id: 'stale-newer',
          name: 'Newer stale task',
          due_date: null,
          updated_at: '2026-04-28T18:00:00.000Z',
        }),
        makeAction({
          id: 'stale-older',
          name: 'Older stale task',
          due_date: null,
          updated_at: '2026-04-10T18:00:00.000Z',
        }),
      ],
      activeActions: [
        makeAction({
          id: 'active-undated',
          name: 'Undated active task',
          due_date: null,
          updated_at: '2026-04-29T18:00:00.000Z',
        }),
        makeAction({
          id: 'active-sooner',
          name: 'Sooner active task',
          due_date: '2026-05-01T12:00:00.000Z',
          updated_at: '2026-04-11T18:00:00.000Z',
        }),
      ],
      workspace: null,
      graphStats: null,
    });

    expect(model.actionInsights.state).toBe('populated');
    expect(model.actionInsights.items.map((item) => item.id)).toEqual([
      'overdue-sooner',
      'overdue-later',
      'stale-older',
      'stale-newer',
      'active-sooner',
    ]);
  });

  it('does not create a spotlight for projects without health signals', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        project_cards: [
          makeProjectCard({
            open_blockers: 0,
            dependency_count: 0,
            recent_changes: 0,
            staleness_days: 0,
          }),
        ],
      }),
      graphStats: null,
    });

    expect(model.spotlight).toBeNull();
    expect(model.quickActions).toEqual([
      { label: 'Ask Pluto', target: 'ask' },
      { label: 'Knowledge home', target: 'wiki' },
    ]);
  });

  it('maps real knowledge docs and matching project health into document cards', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-real',
            title: 'Search Launch Plan',
            structured_json: JSON.stringify({
              current_read: {
                headline: 'Launch readiness depends on search index signoff.',
                source_count: 8,
              },
            }),
            updated_at: '2026-04-27T19:00:00.000Z',
          }),
        ],
        selected_doc: makeDoc({
          id: 'doc-real',
          title: 'Search Launch Plan',
        }),
        project_cards: [
          makeProjectCard({
            doc_id: 'doc-real',
            title: 'Search Launch Plan',
            open_blockers: 2,
            dependency_count: 4,
          }),
        ],
      }),
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.cards[0]).toMatchObject({
      id: 'doc-real',
      title: 'Search Launch Plan',
      description: 'Launch readiness depends on search index signoff.',
      countLabel: '2 blockers · 4 dependencies',
    });
  });

  it('does not serialize old hardcoded homepage sample literals', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ name: 'Review indexing rollout' })],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    const serializedModel = JSON.stringify(model);

    expect(serializedModel).not.toContain('Sarah Chen');
    expect(serializedModel).not.toContain('Product Alignment');
    expect(serializedModel).not.toContain('Finalize Schema');
    expect(serializedModel).not.toContain('API Migration Space');
  });

  it('uses only a clamped first enhanced-notes line when overview is absent', () => {
    const longLine = `${'A'.repeat(220)} should not be visible`;
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [
        makeMeeting({
          analysis_json: undefined,
          enhanced_notes: `\n\n${longLine}\n\nSecond paragraph should not appear.`,
        }),
      ],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });

    expect(model.latestMeeting.state).toBe('populated');
    expect(model.latestMeeting.detail).toHaveLength(183);
    expect(model.latestMeeting.detail.endsWith('...')).toBe(true);
    expect(model.latestMeeting.detail).not.toContain('Second paragraph');
    expect(model.hero.detail).toBe(model.latestMeeting.detail);
  });

  it('uses the singular meeting target for latest meeting hero actions', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });

    expect(model.hero.kind).toBe('latest_meeting');
    expect(model.hero.severity).toBe('calm');
    expect(model.hero.action).toEqual({
      label: 'Review latest',
      target: 'meeting',
      meetingId: 'meeting-1',
    });
  });

  it('preserves numeric meeting ids in meeting actions', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting({ id: 0 })],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });

    expect(model.hero.action).toEqual({
      label: 'Review latest',
      target: 'meeting',
      meetingId: 0,
    });
    expect(model.quickActions).toContainEqual({
      label: 'Review latest',
      target: 'meeting',
      meetingId: 0,
    });
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

    expect(model.hero).toMatchObject({
      kind: 'default',
      title: 'Start with a conversation',
      detail:
        'Record a meeting to build memory, or ask Pluto to help recover context from what is already here.',
      severity: 'calm',
      action: { label: 'Start with Ask Pluto', target: 'ask' },
    });
    expect(model.latestMeeting.state).toBe('empty');
    expect(model.actionInsights.state).toBe('empty');
    expect(model.knowledgeDocuments.state).toBe('empty');
    expect(model.spotlight).toBeNull();
    expect(model.briefingFocus).toEqual({
      kind: 'empty',
      title: 'Build your first briefing',
      detail:
        'Record a conversation and Pluto will turn it into memory, follow-ups, and cited context.',
      action: { label: 'Ask Pluto', target: 'ask' },
    });
    expect(model.quickActions).toEqual([
      { label: 'Start with Ask Pluto', target: 'ask' },
    ]);
  });
});
