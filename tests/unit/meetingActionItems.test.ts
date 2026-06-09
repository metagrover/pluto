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
      attentionStatus: null,
      dismissLabel: null,
      snoozeLabel: null,
    });
    expect(items[1]).toMatchObject({
      id: 'completed',
      title: 'Archive prior draft',
      status: 'completed',
      actionable: true,
      toggleLabel: 'Reopen',
      attentionStatus: null,
      dismissLabel: null,
      snoozeLabel: null,
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
        title: 'Send pricing recap',
        status: 'fallback',
        statusLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        attentionKind: null,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
      {
        id: 'fallback-2',
        title: 'Confirm reseller terms',
        status: 'fallback',
        statusLabel: null,
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        attentionKind: null,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
    ]);
  });

  it('parses fallback owner, due, status, and context metadata into structured cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [makeMeetingEntity({ id: 'topic-1', type: 'topic' })],
      fallbackActionItems: [
        'Send pricing recap (Status: Overdue | Owner: Alex | Due: Friday | Context: Waiting on pricing sign-off.)',
        'Confirm reseller terms (Status: Needs legal review)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'fallback-0',
        title: 'Send pricing recap',
        status: 'overdue',
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: 'Waiting on pricing sign-off.',
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        attentionKind: null,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
        statusLabel: null,
      },
      {
        id: 'fallback-1',
        title: 'Confirm reseller terms',
        status: 'fallback',
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        attentionKind: null,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
        statusLabel: 'Needs legal review',
      },
    ]);
  });

  it('maps linked attention items to dismiss, snooze, and reopen affordances', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'active-follow-up',
          name: 'Send partner recap',
        }),
        makeMeetingEntity({
          id: 'dismissed-follow-up',
          name: 'Schedule optional sync',
        }),
        makeMeetingEntity({
          id: 'snoozed-follow-up',
          name: 'Draft launch FAQ',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-active',
          status: 'active',
          related_entity_ids: ['active-follow-up'],
        },
        {
          id: 'attention-dismissed',
          status: 'dismissed',
          related_entity_ids: ['dismissed-follow-up'],
        },
        {
          id: 'attention-snoozed',
          status: 'snoozed',
          related_entity_ids: ['snoozed-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items[0]).toMatchObject({
      id: 'active-follow-up',
      attentionItemId: 'attention-active',
      attentionStatus: 'active',
      dismissLabel: 'Dismiss',
      snoozeLabel: 'Snooze',
    });
    expect(items[1]).toMatchObject({
      id: 'dismissed-follow-up',
      attentionItemId: 'attention-dismissed',
      attentionStatus: 'dismissed',
      dismissLabel: 'Reopen',
      snoozeLabel: null,
      actionable: false,
    });
    expect(items[2]).toMatchObject({
      id: 'snoozed-follow-up',
      attentionItemId: 'attention-snoozed',
      attentionStatus: 'snoozed',
      dismissLabel: null,
      snoozeLabel: 'Reopen',
      actionable: true,
    });
  });

  it('preserves linked blocker attention context on Meeting View action cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'blocked-follow-up',
          name: 'Finalize vendor contract',
          context: 'Waiting on legal approval before sending.',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-blocker',
          kind: 'blocker',
          reason: 'Legal approval is still pending from procurement.',
          status: 'active',
          related_entity_ids: ['blocked-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items).toMatchObject([
      {
        id: 'blocked-follow-up',
        attentionItemId: 'attention-blocker',
        attentionStatus: 'active',
        attentionKind: 'blocker',
        blockerReason: 'Legal approval is still pending from procurement.',
      },
    ]);
  });
});
