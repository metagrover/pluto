import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { Entity } from '../../src/api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../src/api/knowledgeWorkspace';
import {
  CurrentReadClaimView,
  Dashboard,
  getDashboardReviewActions,
  isCurrentReadClaimClipped,
  reduceCurrentReadClaimState,
} from '../../src/components/features/Dashboard';
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
  metadata: JSON.stringify({ commitment_state: 'confirmed' }),
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
  it('detects current-read overflow from measured geometry', () => {
    expect(
      isCurrentReadClaimClipped({ scrollHeight: 91, clientHeight: 90 }),
    ).toBe(false);
    expect(
      isCurrentReadClaimClipped({ scrollHeight: 140, clientHeight: 90 }),
    ).toBe(true);
  });

  it('renders clipped current-read disclosure accessibly in collapsed and expanded states', () => {
    const claim = '<exact> claim & unchanged';
    const collapsed = renderToStaticMarkup(
      <CurrentReadClaimView
        claim={claim}
        expanded={false}
        isClipped={true}
        onToggle={vi.fn()}
      />,
    );
    const expanded = renderToStaticMarkup(
      <CurrentReadClaimView
        claim={claim}
        expanded={true}
        isClipped={true}
        onToggle={vi.fn()}
      />,
    );

    expect(collapsed).toContain('&lt;exact&gt; claim &amp; unchanged');
    expect(collapsed).toContain('line-clamp-3');
    expect(collapsed).toContain('Show full current read');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-controls="dashboard-current-read-claim"');
    expect(expanded).toContain('&lt;exact&gt; claim &amp; unchanged');
    expect(expanded).not.toContain('line-clamp-3');
    expect(expanded).toContain('Collapse current read');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-controls="dashboard-current-read-claim"');
    expect(collapsed).toContain('id="dashboard-current-read-disclosure"');
    expect(expanded).toContain('id="dashboard-current-read-disclosure"');
  });

  it('toggles expansion and resets it when the claim identity changes', () => {
    const initial = {
      claimIdentity: 'claim one',
      expanded: false,
      isClipped: true,
    };
    const expanded = reduceCurrentReadClaimState(initial, { type: 'toggle' });
    expect(expanded.expanded).toBe(true);

    const reset = reduceCurrentReadClaimState(expanded, {
      type: 'claim-changed',
      claimIdentity: 'claim two',
    });
    expect(reset).toEqual({
      claimIdentity: 'claim two',
      expanded: false,
      isClipped: false,
    });
  });

  it('renders the exact current read as safely wrapping text in a stable collapsed region', () => {
    const exactClaim = `<review>${'unbroken'.repeat(30)}</review> & keep this exact`;
    const doc = makeDoc();
    const structured = JSON.parse(doc.structured_json ?? '{}');
    structured.current_read.headline = exactClaim;
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: makeWorkspace({
        docs: [makeDoc({ structured_json: JSON.stringify(structured) })],
      }),
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
        handleUpdateAttentionStatus={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('id="dashboard-current-read-claim"');
    expect(markup).toContain('line-clamp-3');
    expect(markup).toContain('break-words');
    expect(markup).toContain('text-[24px]');
    expect(markup).toContain('&lt;review&gt;unbrokenunbrokenunbrokenunbroken');
    expect(markup).toContain('&lt;/review&gt; &amp; keep this exact');
    expect(markup).not.toContain('Show full current read');
    expect(markup).not.toContain('Collapse current read');
  });

  it('renders one living memory brief with evidence and a deliberately small attention lane', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [
        makeAction({ id: 'action-1' }),
        makeAction({ id: 'action-2', name: 'Confirm launch owner' }),
        makeAction({ id: 'action-3', name: 'Close privacy review' }),
        makeAction({ id: 'action-4', name: 'Publish launch notes' }),
      ],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
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
        handleUpdateAttentionStatus={vi.fn(async () => {})}
      />,
    );

    expect(markup.match(/Current read/g) ?? []).toHaveLength(1);
    expect(markup).toContain(
      'Search indexing is converging around the rollout plan.',
    );
    expect(markup).toContain('Synthesized from 4 sources in Indexing Rollout.');
    expect(markup).toContain('Open knowledge');
    expect(markup).toContain('Ask Pluto');
    expect(markup).not.toContain('1 blocker · 2 dependencies</p>');
    expect(markup).not.toContain('Ask what changed');
    expect(markup).toContain('Why Pluto believes this');
    expect(markup).toContain('4 sources');
    expect(markup).toContain('Attention');
    expect(
      markup.match(/data-testid="dashboard-attention-row"/g) ?? [],
    ).toHaveLength(3);
    expect(markup).toContain('Review 1 more');
    expect(markup).not.toContain('Focus now');
  });

  it('renders a blocker-specific homepage hero badge for blocker-backed follow-ups', () => {
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
          reason: 'Blocked by legal approval.',
          related_entity_ids: ['action-blocked'],
          related_meeting_ids: [],
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

    expect(markup).toContain('>Blocked<');
    expect(markup).toContain('Finalize launch checklist');
    expect(markup).not.toContain('1 overdue item');
    expect(markup).toContain('Review blockers');
  });

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
          related_meeting_ids: [],
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
    expect(markup).toContain('Dismiss blocker');
    expect(markup).toContain('Snooze blocker');
    expect(markup).toContain('Due Apr 26 · Blocked by legal approval.');
    expect(markup).not.toContain('Due Apr 26 · Work');
  });

  it('uses blocker-specific primary completion labels for blocker-backed follow-up cards', () => {
    const blockedModel = buildDashboardHomeModel({
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
          related_meeting_ids: [],
        }),
      ],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    const blockedMarkup = renderToStaticMarkup(
      <Dashboard
        model={blockedModel}
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

    const routineModel = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction()],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    const routineMarkup = renderToStaticMarkup(
      <Dashboard
        model={routineModel}
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

    expect(blockedMarkup).toContain('Resolve blocker');
    expect(blockedMarkup).not.toContain('Mark complete');
    expect(routineMarkup).toContain('Mark complete');
    expect(routineMarkup).not.toContain('Resolve blocker');
  });

  it('uses the primary action status chip for blocker-backed follow-up cards', () => {
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
          related_meeting_ids: [],
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

    expect(markup).toContain('>Blocker<');
    expect(markup).not.toContain('>overdue<');
  });

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
        setSelectedMeetingId={vi.fn()}
        setActiveTab={vi.fn()}
        setAskPlutoVisible={vi.fn()}
        updatingTaskIds={new Set()}
        actionError={null}
        handleCompleteTask={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('Ship privacy review');
    expect(markup).toContain('Due Apr 26 · Launch Review');
    expect(markup).not.toContain('Due Apr 26 · Work');
  });

  it('renders a blocker-specific spotlight badge when the spotlight project is blocked', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
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

    expect(markup).toContain('Blocked');
    expect(markup).not.toContain('>Projects<');
  });

  it('renders a blocker-specific spotlight section label when the spotlight project is blocked', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
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

    expect(markup).toContain('Blocked project signal');
    expect(markup).not.toContain('>Project signal<');
  });

  it('keeps the generic spotlight section label when the spotlight project is not blocked', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [],
        project_cards: [
          makeProjectCard({
            open_blockers: 0,
            dependency_count: 2,
            recent_changes: 1,
          }),
        ],
      }),
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

    expect(markup).toContain('Project signal');
    expect(markup).not.toContain('Blocked project signal');
  });

  it('renders a blocker-specific spotlight quick action', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: makeWorkspace({
        docs: [],
        project_cards: [
          makeProjectCard({
            open_blockers: 2,
            dependency_count: 0,
            recent_changes: 0,
          }),
        ],
      }),
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
    expect(markup).toContain('Review blockers');
  });

  it('keeps completion-oriented labels for overdue and stale follow-up cards', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ id: 'action-overdue' })],
      staleActions: [
        makeAction({
          id: 'action-stale',
          name: 'Follow up with legal',
          due_date: null,
          updated_at: '2026-04-10T10:00:00.000Z',
        }),
      ],
      activeActions: [],
      attentionAlerts: [],
      workspace: null,
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
    expect(markup.match(/Mark complete/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain('Reopen');
  });

  it('renders possible follow-ups as reviewable evidence without settled-work controls', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [
        makeAction({
          name: 'Check whether privacy review is assigned',
          metadata: JSON.stringify({
            commitment_state: 'possible',
            origin: 'extraction',
            source_meeting_id: 'meeting-1',
          }),
        }),
      ],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: null,
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
        handleReviewCommitment={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('Needs review');
    expect(markup).toContain(
      'Possible follow-up · From Launch Review · Apr 27, 2026',
    );
    expect(markup).toContain('Review source');
    expect(markup).toContain('Confirm task');
    expect(markup).toContain('Not a task');
    expect(markup).toMatch(
      /aria-label="Review source for Check whether privacy review is assigned"[^>]+focus-visible:outline-pro-accent/,
    );
    expect(markup).toMatch(
      /aria-label="Confirm task: Check whether privacy review is assigned"[^>]+focus-visible:outline-pro-accent/,
    );
    expect(markup).toMatch(
      /aria-label="Not a task: Check whether privacy review is assigned"[^>]+focus-visible:outline-pro-accent/,
    );
    expect(markup).not.toContain('Mark complete');
    expect(markup).not.toContain('Resolve blocker');
    expect(markup).not.toContain(
      'Mark Check whether privacy review is assigned complete',
    );
  });

  it('renders a truthful Review task affordance when possible evidence has no source meeting', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction({
          metadata: JSON.stringify({ commitment_state: 'possible' }),
        }),
      ],
      workspace: null,
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
        handleReviewCommitment={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('Review task');
    expect(markup).toContain('<details');
    expect(markup).toContain(
      'No source meeting is available. Review the wording above, then confirm it or mark it not a task.',
    );
    expect(markup).not.toContain('Review source');
  });

  it('keeps source-less review inline instead of exporting a navigation action', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction({
          id: 'action-without-source',
          metadata: JSON.stringify({ commitment_state: 'possible' }),
        }),
      ],
      workspace: null,
      graphStats: null,
    });
    const actions = getDashboardReviewActions(model.actionInsights.items[0], {
      setSelectedMeetingId: vi.fn(),
      handleReviewCommitment: vi.fn(async () => {}),
    });

    expect(actions.map((action) => action.label)).toEqual([
      'Confirm task',
      'Not a task',
    ]);
  });

  it('binds possible follow-up review actions to the exact source and action state', async () => {
    const setSelectedMeetingId = vi.fn();
    const handleReviewCommitment = vi.fn(async () => {});
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting({ id: 'meeting-exact' })],
      overdueActions: [
        makeAction({
          id: 'action-exact',
          metadata: JSON.stringify({
            commitment_state: 'possible',
            source_meeting_id: 'meeting-exact',
          }),
        }),
      ],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });
    const item = model.actionInsights.items[0];
    const actions = getDashboardReviewActions(item, {
      setSelectedMeetingId,
      handleReviewCommitment,
    });

    actions[0].onClick();
    await actions[1].onClick();
    await actions[2].onClick();

    expect(setSelectedMeetingId).toHaveBeenCalledWith('meeting-exact');
    expect(handleReviewCommitment).toHaveBeenNthCalledWith(
      1,
      'action-exact',
      'confirmed',
    );
    expect(handleReviewCommitment).toHaveBeenNthCalledWith(
      2,
      'action-exact',
      'rejected',
    );
  });

  it('keeps possible blockers out of completion and blocker lifecycle controls', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [
        makeAction({
          metadata: JSON.stringify({ commitment_state: 'possible' }),
        }),
      ],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [makeAttentionItem({ kind: 'blocker' })],
      workspace: null,
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
        handleReviewCommitment={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('Needs review');
    expect(markup).not.toContain('Resolve blocker');
    expect(markup).not.toContain('Dismiss blocker');
    expect(markup).not.toContain('Snooze blocker');
  });

  it('renders the model-generated action insight summary', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [makeAction()],
      staleActions: [],
      activeActions: [],
      workspace: null,
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
        handleReviewCommitment={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain('1 confirmed commitment needs attention.');
    expect(markup).not.toContain('Only the highest-value signals');
  });

  it('gives confirmed blocker lifecycle controls specific labels and visible focus rings', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [makeAction({ id: 'confirmed-blocker' })],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [
        makeAttentionItem({
          kind: 'blocker',
          related_entity_ids: ['confirmed-blocker'],
        }),
      ],
      workspace: null,
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
        handleReviewCommitment={vi.fn(async () => {})}
      />,
    );

    expect(markup).toMatch(
      /aria-label="Dismiss blocker: Ship privacy review"[^>]+focus-visible:outline-pro-accent/,
    );
    expect(markup).toMatch(
      /aria-label="Snooze blocker: Ship privacy review"[^>]+focus-visible:outline-pro-accent/,
    );
  });
});
