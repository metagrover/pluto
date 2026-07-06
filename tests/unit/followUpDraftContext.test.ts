import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  buildDefaultDrafts,
  buildFollowUpDraftContext,
  buildFollowUpDraftDecisions,
  buildFollowUpDraftDiscussionPoints,
  buildFollowUpDraftOpenQuestions,
  buildFollowUpDraftTopicSummaries,
  formatFollowUpDraftActionItem,
} from '../../src/components/features/followUpDraftContext';
import type { MeetingLinkedAttentionItem } from '../../src/components/features/meetingActionItems';
import type { AnalysisDocumentV3 } from '../../src/types';

type MeetingEntitySummary = Entity & {
  mention_count: number;
  context: string | null;
};

const makeEntity = (
  overrides: Partial<MeetingEntitySummary>,
): MeetingEntitySummary => ({
  id: overrides.id || 'entity-1',
  type: overrides.type || 'action_item',
  name: overrides.name || 'Default entity',
  normalized_name: overrides.normalized_name || 'default entity',
  status: overrides.status ?? 'active',
  due_date: overrides.due_date ?? null,
  assigned_to: overrides.assigned_to ?? null,
  metadata: overrides.metadata ?? null,
  saliency_score: overrides.saliency_score ?? 0,
  domain_tag: overrides.domain_tag || 'general',
  created_at: overrides.created_at || '2026-05-27T00:00:00.000Z',
  updated_at: overrides.updated_at || '2026-05-27T00:00:00.000Z',
  mention_count: overrides.mention_count ?? 1,
  context: overrides.context ?? null,
});

const makeAnalysis = (
  overrides: Partial<AnalysisDocumentV3> = {},
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: overrides.overview || 'Overview',
  topics: overrides.topics || [],
  all_action_items: overrides.all_action_items || [],
  all_decisions: overrides.all_decisions || [],
  meeting_type: overrides.meeting_type || 'general',
  quality: overrides.quality || {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
  generation_metadata: overrides.generation_metadata,
});

describe('buildFollowUpDraftContext', () => {
  it('prefers linked action-item metadata and resolves participant ids to names', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: ['Plain fallback item'],
      linkedEntities: [
        makeEntity({
          id: 'person-2',
          type: 'person',
          name: 'Alex Rivera',
          mention_count: 1,
        }),
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
          assigned_to: 'person-1',
          due_date: '2026-05-30T00:00:00.000Z',
          mention_count: 3,
        }),
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          metadata: JSON.stringify({ role: 'Engineering Lead' }),
          mention_count: 4,
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Owner: Sarah Chen (Engineering Lead) | Due: May 30)',
      'Plain fallback item',
    ]);
    expect(context.participants).toEqual([
      'Sarah Chen (Engineering Lead)',
      'Alex Rivera',
    ]);
    expect(context.entityContext).toEqual([]);
  });

  it('includes linked owner role context when Pluto already knows it', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
          assigned_to: 'person-1',
          due_date: '2026-05-30T00:00:00.000Z',
          mention_count: 2,
        }),
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          mention_count: 3,
          metadata: JSON.stringify({ role: 'Head of Product' }),
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Owner: Sarah Chen (Head of Product) | Due: May 30)',
    ]);
  });

  it('falls back to the existing action-item strings when no linked action items exist', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: ['Confirm launch plan'],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Taylor Brooks',
        }),
      ],
    });

    expect(context.actionItems).toEqual(['Confirm launch plan']);
    expect(context.participants).toEqual(['Taylor Brooks']);
    expect(context.entityContext).toEqual([]);
  });

  it('keeps raw owner and due values when linked people or ISO dates are unavailable', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Confirm launch plan',
          assigned_to: 'Platform Team',
          due_date: 'Friday',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Confirm launch plan (Owner: Platform Team | Due: Friday)',
    ]);
    expect(context.participants).toEqual([]);
    expect(context.entityContext).toEqual([]);
  });

  it('falls back to plain participant names when metadata is malformed', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Taylor Brooks',
          metadata: '{bad-json',
        }),
      ],
    });

    expect(context.participants).toEqual(['Taylor Brooks']);
  });

  it('derives deduped topic and project context lines from linked entities', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: ['Confirm launch plan'],
      linkedEntities: [
        makeEntity({
          id: 'project-1',
          type: 'project',
          name: 'Apollo rollout',
          mention_count: 4,
        }),
        makeEntity({
          id: 'topic-1',
          type: 'topic',
          name: 'API migration',
          mention_count: 3,
        }),
        makeEntity({
          id: 'topic-2',
          type: 'topic',
          name: 'api migration',
          normalized_name: 'api migration',
          mention_count: 2,
        }),
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          mention_count: 5,
        }),
      ],
    });

    expect(context.entityContext).toEqual([
      'Project: Apollo rollout',
      'Topic: API migration',
    ]);
  });

  it('preserves fallback topic detail when linked action items add owner and due metadata', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Send rollout email (Topic: Launch planning | Owner: Sarah Chen | Due: Friday)',
      ],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
        }),
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
          assigned_to: 'person-1',
          due_date: 'Friday',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Topic: Launch planning | Owner: Sarah Chen | Due: Friday)',
    ]);
  });

  it('preserves fallback owner and due detail when linked action items are sparser', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Send rollout email (Topic: Launch planning | Owner: Sarah Chen | Due: Friday)',
      ],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
          context: 'Needs final approval before send.',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Topic: Launch planning | Owner: Sarah Chen | Due: Friday | Context: Needs final approval before send.)',
    ]);
  });

  it('preserves fallback owner role detail when linked people are sparser', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Send rollout email (Owner: Sarah Chen (Head of Product) | Due: Friday)',
      ],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
        }),
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
          assigned_to: 'person-1',
          due_date: 'Friday',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Owner: Sarah Chen (Head of Product) | Due: Friday)',
    ]);
  });

  it('preserves fallback status and context detail when linked action items are sparser', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Send rollout email (Topic: Launch planning | Status: Overdue | Context: Waiting on pricing sign-off.)',
      ],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send rollout email',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Topic: Launch planning | Status: Overdue | Context: Waiting on pricing sign-off.)',
    ]);
  });

  it('omits completed, dismissed, and snoozed follow-ups from draft action items', () => {
    const linkedAttentionItems: MeetingLinkedAttentionItem[] = [
      {
        id: 'attention-dismissed',
        status: 'dismissed',
        related_entity_ids: ['action-dismissed'],
      },
      {
        id: 'attention-snoozed',
        status: 'snoozed',
        related_entity_ids: ['action-snoozed'],
      },
    ];

    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Ship active task',
        'Archive old recap',
        'Silence duplicate reminder',
        'Revisit next week',
        'Unlinked fallback item',
      ],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          mention_count: 4,
        }),
        makeEntity({
          id: 'action-active',
          type: 'action_item',
          name: 'Ship active task',
          assigned_to: 'person-1',
          due_date: '2026-06-02T00:00:00.000Z',
          mention_count: 5,
        }),
        makeEntity({
          id: 'action-completed',
          type: 'action_item',
          name: 'Archive old recap',
          status: 'completed',
          mention_count: 3,
        }),
        makeEntity({
          id: 'action-dismissed',
          type: 'action_item',
          name: 'Silence duplicate reminder',
          mention_count: 2,
        }),
        makeEntity({
          id: 'action-snoozed',
          type: 'action_item',
          name: 'Revisit next week',
          mention_count: 1,
        }),
      ],
      linkedAttentionItems,
    });

    expect(context.actionItems).toEqual([
      'Ship active task (Owner: Sarah Chen | Due: Jun 2)',
      'Unlinked fallback item',
    ]);
  });

  it('preserves overdue and stale lifecycle context for linked follow-ups only', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Escalate contract edits',
          status: 'overdue',
          assigned_to: 'person-1',
          due_date: '2026-06-02T00:00:00.000Z',
          mention_count: 4,
        }),
        makeEntity({
          id: 'action-2',
          type: 'action_item',
          name: 'Refresh launch brief',
          status: 'stale',
          mention_count: 3,
        }),
        makeEntity({
          id: 'action-3',
          type: 'action_item',
          name: 'Share rollout notes',
          status: 'active',
          mention_count: 2,
        }),
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          mention_count: 1,
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Escalate contract edits (Status: Overdue | Owner: Sarah Chen | Due: Jun 2)',
      'Refresh launch brief (Status: Stale)',
      'Share rollout notes',
    ]);
  });

  it('preserves blocked follow-up context from linked blocker attention items', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
        }),
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Confirm launch plan',
          assigned_to: 'person-1',
          due_date: '2026-05-30T00:00:00.000Z',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-1',
          kind: 'blocker',
          status: 'active',
          reason: 'Blocked by legal approval.',
          related_entity_ids: ['action-1'],
        },
      ],
    });

  expect(context.actionItems).toEqual([
      'Confirm launch plan (Owner: Sarah Chen | Due: May 30 | Status: Blocked by legal approval)',
    ]);
  });

  it('prioritizes fallback-only blocked and aging follow-ups ahead of routine linked work', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [
        'Wait for legal sign-off (Status: Blocked on legal review)',
        'Escalate contract edits (Status: Overdue)',
        'Refresh launch brief (Status: Stale)',
      ],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Share routine recap',
          mention_count: 5,
        }),
        makeEntity({
          id: 'action-2',
          type: 'action_item',
          name: 'Confirm attendee list',
          mention_count: 4,
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Wait for legal sign-off (Status: Blocked on legal review)',
      'Escalate contract edits (Status: Overdue)',
      'Refresh launch brief (Status: Stale)',
      'Share routine recap',
      'Confirm attendee list',
    ]);
  });

  it('preserves linked action-item context in the draft action lines', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      linkedEntities: [
        makeEntity({
          id: 'action-1',
          type: 'action_item',
          name: 'Send pricing recap',
          assigned_to: 'person-1',
          due_date: '2026-05-30T00:00:00.000Z',
          context: 'Alex committed to send the pricing recap by Friday.',
        }),
        makeEntity({
          id: 'person-1',
          type: 'person',
          name: 'Alex Rivera',
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send pricing recap (Owner: Alex Rivera | Due: May 30 | Context: Alex committed to send the pricing recap by Friday.)',
    ]);
  });

  it('prefers linked decision rationale and preserves unmatched fallback decisions', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      fallbackDecisions: ['Use REST for the rollout', 'Share roadmap update'],
      linkedEntities: [
        makeEntity({
          id: 'decision-1',
          type: 'decision',
          name: 'Use REST for the rollout',
          context: 'Better type safety and query flexibility',
          mention_count: 3,
        }),
      ],
    });

    expect(context.decisions).toEqual([
      'Use REST for the rollout (Why: Better type safety and query flexibility)',
      'Share roadmap update',
    ]);
  });

  it('falls back to plain decision text when no linked rationale exists', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      fallbackDecisions: ['Use REST for the rollout'],
      linkedEntities: [],
    });

    expect(context.decisions).toEqual(['Use REST for the rollout']);
  });

  it('preserves richer fallback decision details when linked decisions match the same item', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: [],
      fallbackDecisions: [
        'Use REST for the rollout (Topic: API migration | Decided by: Sarah Chen | Why: Better type safety and query flexibility)',
        'Share roadmap update',
      ],
      linkedEntities: [
        makeEntity({
          id: 'decision-1',
          type: 'decision',
          name: 'Use REST for the rollout',
          context: 'Better type safety and query flexibility',
        }),
      ],
    });

    expect(context.decisions).toEqual([
      'Use REST for the rollout (Topic: API migration | Decided by: Sarah Chen | Why: Better type safety and query flexibility)',
      'Share roadmap update',
    ]);
  });

  it('injects participant context into default draft templates', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'API Migration Review',
      actionItems: ['Send rollout email (Owner: Sarah Chen | Due: May 30)'],
      decisions: ['Use REST for the rollout'],
      overview: ['The team aligned on the rollout shape and timing.'],
      entityContext: ['Project: Apollo rollout', 'Topic: API migration'],
      discussionPoints: [
        'The team needs provenance on each API response.',
        'The graph schema still needs validation before rollout.',
      ],
      participants: ['Sarah Chen (Engineering Lead)', 'Alex Rivera'],
      openQuestions: [
        'API Migration: Should the mobile client move in the same release?',
      ],
      topicSummaries: ['API Migration: The team aligned on rollout scope.'],
    });

    expect(drafts.client).toContain(
      'Context:\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.client).toContain(
      'Participants: Sarah Chen (Engineering Lead), Alex Rivera',
    );
    expect(drafts.client).toContain(
      'Linked Context:\n- Project: Apollo rollout',
    );
    expect(drafts.client).toContain(
      'Discussion Context:\n- API Migration: The team aligned on rollout scope.',
    );
    expect(drafts.client).toContain(
      '- The team needs provenance on each API response.',
    );
    expect(drafts.internal).toContain(
      'Context:\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.internal).toContain(
      'Participants: Sarah Chen (Engineering Lead), Alex Rivera',
    );
    expect(drafts.internal).toContain(
      'Linked Context:\n- Project: Apollo rollout',
    );
    expect(drafts.internal).toContain(
      'Discussion Context:\n- API Migration: The team aligned on rollout scope.',
    );
    expect(drafts.slack).toContain(
      '*Context:*\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.slack).toContain(
      '*Participants:* Sarah Chen (Engineering Lead), Alex Rivera',
    );
    expect(drafts.slack).toContain(
      '*Linked Context:*\n- Project: Apollo rollout',
    );
    expect(drafts.client).toContain(
      'Open Questions:\n- API Migration: Should the mobile client move in the same release?',
    );
    expect(drafts.slack).toContain(
      '*Discussion Context:*\n- API Migration: The team aligned on rollout scope.',
    );
  });
});

describe('buildFollowUpDraftOpenQuestions', () => {
  it('formats topic-labeled unresolved questions and removes duplicates or blanks', () => {
    const questions = buildFollowUpDraftOpenQuestions([
      {
        title: 'API Migration',
        open_questions: [
          'Should the mobile client move in the same release?',
          '  ',
        ],
      },
      {
        title: 'Launch Planning',
        open_questions: ['Who will own the launch email?'],
      },
      {
        title: 'API Migration',
        open_questions: ['Should the mobile client move in the same release?'],
      },
    ]);

    expect(questions).toEqual([
      'API Migration: Should the mobile client move in the same release?',
      'Launch Planning: Who will own the launch email?',
    ]);
  });
});

describe('buildFollowUpDraftTopicSummaries', () => {
  it('formats topic-labeled summaries and removes empty or duplicate items', () => {
    expect(
      buildFollowUpDraftTopicSummaries([
        { title: 'API Migration', summary: 'Align on rollout scope.' },
        { title: 'Launch Prep', summary: 'Confirm owner handoff.' },
        { title: 'API Migration', summary: 'Align on rollout scope.' },
        { title: 'Ignored', summary: '   ' },
      ]),
    ).toEqual([
      'API Migration: Align on rollout scope.',
      'Launch Prep: Confirm owner handoff.',
    ]);
  });
});

describe('buildFollowUpDraftDiscussionPoints', () => {
  it('formats topic key points with topic labels and removes duplicates', () => {
    const discussionPoints = buildFollowUpDraftDiscussionPoints([
      {
        title: 'API Responses',
        summary: 'Summary',
        decisions: [],
        action_items: [],
        open_questions: [],
        key_points: [
          { text: 'The team needs provenance on each API response.' },
          { text: 'The graph schema still needs validation before rollout.' },
        ],
      },
      {
        title: 'Rollout',
        summary: 'Summary',
        decisions: [],
        action_items: [],
        open_questions: [],
        key_points: [
          { text: 'The graph schema still needs validation before rollout.' },
        ],
      },
    ]);

    expect(discussionPoints).toEqual([
      'API Responses: The team needs provenance on each API response.',
      'API Responses: The graph schema still needs validation before rollout.',
    ]);
  });

  it('omits overview context when no usable summary lines exist', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'API Migration Review',
      actionItems: ['Send rollout email'],
      decisions: ['Use REST for the rollout'],
      overview: ['   ', ''],
      participants: ['Sarah Chen'],
    });

    expect(drafts.client).not.toContain('Context:');
    expect(drafts.internal).not.toContain('Context:');
    expect(drafts.slack).not.toContain('*Context:*');
  });
});

describe('formatFollowUpDraftActionItem', () => {
  it('includes topic context ahead of owner and due details when present', () => {
    expect(
      formatFollowUpDraftActionItem({
        text: 'Send rollout email',
        topic: 'Launch planning',
        assignee: 'Sarah Chen',
        due: 'Friday',
      }),
    ).toBe(
      'Send rollout email (Topic: Launch planning | Owner: Sarah Chen | Due: Friday)',
    );
  });

  it('falls back to the raw text when no topic or metadata is available', () => {
    expect(
      formatFollowUpDraftActionItem({
        text: 'Confirm launch plan',
      }),
    ).toBe('Confirm launch plan');
  });
});

describe('buildFollowUpDraftDecisions', () => {
  it('adds topic labels to topic-linked v3 decisions before falling back', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: ['Use REST for the rollout', 'Confirm launch owner'],
      analysis: makeAnalysis({
        topics: [
          {
            title: 'API migration',
            summary: 'Summary',
            key_points: [],
            decisions: [{ text: 'Use REST for the rollout' }],
            action_items: [],
            open_questions: [],
          },
        ],
      }),
    });

    expect(decisions).toEqual([
      'Use REST for the rollout (Topic: API migration)',
      'Confirm launch owner',
    ]);
  });

  it('includes decision owners and rationale from v3 analysis when available', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: [
        'Use REST for the rollout',
        'Send status update after launch',
      ],
      analysis: makeAnalysis({
        all_decisions: [
          {
            text: 'Use REST for the rollout',
            decided_by: 'Sarah Chen',
            rationale: 'The mobile clients need predictable cache behavior.',
          },
        ],
      }),
    });

    expect(decisions).toEqual([
      'Use REST for the rollout (Decided by: Sarah Chen | Why: The mobile clients need predictable cache behavior.)',
      'Send status update after launch',
    ]);
  });

  it('preserves fallback decision owner role detail when linked v3 owner data is thinner', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: [
        'Use REST for the rollout (Decided by: Sarah Chen (Head of Product) | Why: Better type safety and query flexibility)',
      ],
      analysis: makeAnalysis({
        all_decisions: [
          {
            text: 'Use REST for the rollout',
            decided_by: 'Sarah Chen',
            rationale: 'Better type safety and query flexibility',
          },
        ],
      }),
    });

    expect(decisions).toEqual([
      'Use REST for the rollout (Decided by: Sarah Chen (Head of Product) | Why: Better type safety and query flexibility)',
    ]);
  });

  it('keeps fallback decisions when no topic-linked v3 decision context exists', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: ['Use REST for the rollout'],
      analysis: makeAnalysis(),
    });

    expect(decisions).toEqual(['Use REST for the rollout']);
  });

  it('preserves richer fallback decision detail when v3 decision data is thinner', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: [
        'Use REST for the rollout (Topic: API migration | Decided by: Sarah Chen | Why: Better type safety and query flexibility)',
        'Share roadmap update',
      ],
      analysis: makeAnalysis({
        all_decisions: [{ text: 'Use REST for the rollout' }],
      }),
    });

    expect(decisions).toEqual([
      'Use REST for the rollout (Topic: API migration | Decided by: Sarah Chen | Why: Better type safety and query flexibility)',
      'Share roadmap update',
    ]);
  });
});
