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
    expect(context.entityContext).toEqual([]);
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

  it('injects participant and entity context into default draft templates', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'API Migration Review',
      actionItems: ['Send rollout email (Owner: Sarah Chen | Due: May 30)'],
      decisions: ['Use REST for the rollout'],
      entityContext: ['Project: Apollo rollout', 'Topic: API migration'],
      participants: ['Sarah Chen', 'Alex Rivera'],
    });

    expect(drafts.client).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.client).toContain(
      'Linked Context:\n- Project: Apollo rollout',
    );
    expect(drafts.internal).toContain('Participants: Sarah Chen, Alex Rivera');
    expect(drafts.internal).toContain(
      'Linked Context:\n- Project: Apollo rollout',
    );
    expect(drafts.slack).toContain('*Participants:* Sarah Chen, Alex Rivera');
    expect(drafts.slack).toContain(
      '*Linked Context:*\n- Project: Apollo rollout',
    );
  });
});
