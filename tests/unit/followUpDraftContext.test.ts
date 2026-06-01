import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  buildDefaultDrafts,
  buildFollowUpDraftContext,
  buildFollowUpDraftDecisions,
  formatFollowUpDraftActionItem,
} from '../../src/components/features/followUpDraftContext';
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
          mention_count: 4,
        }),
      ],
    });

    expect(context.actionItems).toEqual([
      'Send rollout email (Owner: Sarah Chen | Due: May 30)',
      'Plain fallback item',
    ]);
    expect(context.participants).toEqual(['Sarah Chen', 'Alex Rivera']);
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
  });

  it('does not duplicate linked action items when fallback labels already include topic metadata', () => {
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
      'Send rollout email (Owner: Sarah Chen | Due: Friday)',
    ]);
  });

  it('injects participant context into default draft templates', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'API Migration Review',
      actionItems: ['Send rollout email (Owner: Sarah Chen | Due: May 30)'],
      decisions: ['Use REST for the rollout'],
      overview: ['The team aligned on the rollout shape and timing.'],
      participants: ['Sarah Chen', 'Alex Rivera'],
    });

    expect(drafts.client).toContain(
      'Context:\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.client).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.internal).toContain(
      'Context:\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.internal).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.slack).toContain(
      '*Context:*\n- The team aligned on the rollout shape and timing.',
    );
    expect(drafts.slack).toContain('*Participants:* Sarah Chen, Alex Rivera');
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

  it('keeps fallback decisions when no topic-linked v3 decision context exists', () => {
    const decisions = buildFollowUpDraftDecisions({
      fallbackDecisions: ['Use REST for the rollout'],
      analysis: makeAnalysis(),
    });

    expect(decisions).toEqual(['Use REST for the rollout']);
  });
});
