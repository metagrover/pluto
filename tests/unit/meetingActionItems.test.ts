import { describe, expect, it } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';
import { buildMeetingActionItems } from '../../src/components/features/meetingActionItems';

type MeetingEntity = Entity & {
  mention_count: number;
  context: string | null;
};

const makeMeetingEntity = (
  overrides: Partial<MeetingEntity> = {},
): MeetingEntity => ({
  id: 'action-1',
  type: 'action_item',
  name: 'Send pricing recap',
  normalized_name: 'send pricing recap',
  status: 'active',
  due_date: '2026-05-30T15:00:00.000Z',
  assigned_to: 'Alex',
  metadata: null,
  saliency_score: 0.8,
  domain_tag: 'work',
  created_at: '2026-05-26T18:00:00.000Z',
  updated_at: '2026-05-26T18:00:00.000Z',
  mention_count: 2,
  context: 'Alex committed to send the pricing recap by Friday.',
  ...overrides,
});

describe('buildMeetingActionItems', () => {
  it('prefers linked action-item entities and sorts active work before completed items', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'completed',
          name: 'Archive prior draft',
          status: 'completed',
          assigned_to: null,
          due_date: null,
          mention_count: 1,
          created_at: '2026-05-25T18:00:00.000Z',
        }),
        makeMeetingEntity(),
        makeMeetingEntity({
          id: 'topic-1',
          type: 'topic',
          name: 'Pricing strategy',
          normalized_name: 'pricing strategy',
          status: null,
        }),
      ],
      fallbackActionItems: ['Fallback should not be used'],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'action-1',
      title: 'Send pricing recap',
      status: 'active',
      assignee: 'Alex',
      dueLabel: 'Due May 30',
      context: 'Alex committed to send the pricing recap by Friday.',
      actionable: true,
      toggleLabel: 'Mark complete',
    });
    expect(items[1]).toMatchObject({
      id: 'completed',
      title: 'Archive prior draft',
      status: 'completed',
      actionable: true,
      toggleLabel: 'Reopen',
    });
  });

  it('falls back to analysis text when no linked action-item entities exist', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [makeMeetingEntity({ id: 'topic-1', type: 'topic' })],
      fallbackActionItems: [
        'Send pricing recap (Owner: Alex | Due: Friday)',
        '',
        'Confirm reseller terms',
      ],
    });

    expect(items).toEqual([
      {
        id: 'fallback-0',
        title: 'Send pricing recap (Owner: Alex | Due: Friday)',
        status: 'fallback',
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
      },
      {
        id: 'fallback-2',
        title: 'Confirm reseller terms',
        status: 'fallback',
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
      },
    ]);
  });
});
