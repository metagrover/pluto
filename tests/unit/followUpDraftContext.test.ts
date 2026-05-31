import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  buildDefaultDrafts,
  buildFollowUpDraftContext,
} from '../../src/components/features/followUpDraftContext';

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

describe('buildFollowUpDraftContext', () => {
  it('prefers linked action-item metadata and resolves participant ids to names', () => {
    const context = buildFollowUpDraftContext({
      fallbackActionItems: ['Plain fallback item'],
      fallbackDecisions: [],
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
      fallbackDecisions: [],
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
      fallbackDecisions: [],
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
    expect(context.decisions).toEqual([]);
    expect(context.participants).toEqual([]);
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

  it('injects participant context into default draft templates', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'API Migration Review',
      actionItems: ['Send rollout email (Owner: Sarah Chen | Due: May 30)'],
      decisions: [
        'Use REST for the rollout (Why: Better type safety and query flexibility)',
      ],
      participants: ['Sarah Chen', 'Alex Rivera'],
    });

    expect(drafts.client).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.internal).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.slack).toContain('*Participants:* Sarah Chen, Alex Rivera');
    expect(drafts.client).toContain(
      'Use REST for the rollout (Why: Better type safety and query flexibility)',
    );
  });
});
