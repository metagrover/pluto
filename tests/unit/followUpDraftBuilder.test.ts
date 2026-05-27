import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import {
  buildDefaultDrafts,
  buildFollowUpContext,
} from '../../src/components/features/followUpDraftBuilder';

const makeEntity = (
  overrides: Partial<Entity> & Pick<Entity, 'id' | 'type' | 'name'>,
): Entity => ({
  id: overrides.id,
  type: overrides.type,
  name: overrides.name,
  normalized_name: overrides.name.toLowerCase(),
  status: overrides.status ?? 'active',
  due_date: overrides.due_date ?? null,
  assigned_to: overrides.assigned_to ?? null,
  metadata: overrides.metadata ?? null,
  saliency_score: overrides.saliency_score ?? 0,
  domain_tag: overrides.domain_tag ?? 'workspace',
  created_at: overrides.created_at ?? '2026-05-27T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-05-27T00:00:00.000Z',
});

describe('buildFollowUpContext', () => {
  it('prefers linked action-item owner and due-date context over plain text', () => {
    const context = buildFollowUpContext({
      meetingTitle: 'Weekly Product Sync',
      fallbackActionItems: ['Send recap', 'Confirm launch timing'],
      decisions: ['Keep launch date unchanged'],
      meetingEntities: [
        makeEntity({ id: 'person-alex', type: 'person', name: 'Alex' }),
        makeEntity({
          id: 'action-recap',
          type: 'action_item',
          name: 'Send recap',
          assigned_to: 'person-alex',
          due_date: '2026-05-30T00:00:00.000Z',
        }),
        makeEntity({
          id: 'action-launch',
          type: 'action_item',
          name: 'Confirm launch timing',
        }),
      ],
    });

    expect(context.participants).toEqual(['Alex']);
    expect(context.actionItems).toEqual([
      'Send recap (Owner: Alex | Due: May 30)',
      'Confirm launch timing',
    ]);
  });

  it('falls back to plain action items and no participants when linked entities are absent', () => {
    const context = buildFollowUpContext({
      meetingTitle: 'Weekly Product Sync',
      fallbackActionItems: ['Send recap'],
      decisions: [],
      meetingEntities: [],
    });

    expect(context.participants).toEqual([]);
    expect(context.actionItems).toEqual(['Send recap']);
  });
});

describe('buildDefaultDrafts', () => {
  it('includes participant context and enriched action bullets in generated drafts', () => {
    const drafts = buildDefaultDrafts({
      meetingTitle: 'Weekly Product Sync',
      participants: ['Alex', 'Jordan'],
      actionItems: ['Send recap (Owner: Alex | Due: May 30)'],
      decisions: ['Keep launch date unchanged'],
    });

    expect(drafts.client).toContain('Participants: Alex, Jordan');
    expect(drafts.client).toContain('- Send recap (Owner: Alex | Due: May 30)');
    expect(drafts.internal).toContain('Participants: Alex, Jordan');
    expect(drafts.slack).toContain('*Participants:* Alex, Jordan');
  });
});
