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
      fallbackActionItems: ['Send pricing recap'],
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

  it('resolves linked action-item owner ids through meeting people when available', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'person-1',
          type: 'person',
          name: 'Alex Rivera',
          normalized_name: 'alex rivera',
          status: null,
          due_date: null,
          assigned_to: null,
          mention_count: 4,
          context: null,
        }),
        makeMeetingEntity({
          id: 'action-owner-id',
          name: 'Send pricing recap',
          assigned_to: 'person-1',
        }),
        makeMeetingEntity({
          id: 'action-owner-raw',
          name: 'Confirm reseller terms',
          assigned_to: 'Platform Team',
          mention_count: 1,
        }),
      ],
      fallbackActionItems: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'action-owner-id',
        assignee: 'Alex Rivera',
      }),
      expect.objectContaining({
        id: 'action-owner-raw',
        assignee: 'Platform Team',
      }),
    ]);
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
        topicLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionKindLabel: null,
        attentionStatus: null,
        isBlocked: false,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
      {
        id: 'fallback-2',
        title: 'Confirm reseller terms',
        status: 'fallback',
        statusLabel: null,
        topicLabel: null,
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionKindLabel: null,
        attentionStatus: null,
        isBlocked: false,
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
        topicLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: 'Waiting on pricing sign-off.',
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionKindLabel: null,
        attentionStatus: null,
        isBlocked: false,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
        statusLabel: null,
      },
      {
        id: 'fallback-1',
        title: 'Confirm reseller terms',
        status: 'fallback',
        topicLabel: null,
        assignee: null,
        dueLabel: null,
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionKindLabel: null,
        attentionStatus: null,
        isBlocked: false,
        blockerReason: null,
        dismissLabel: null,
        snoozeLabel: null,
        statusLabel: 'Needs legal review',
      },
    ]);
  });

  it('preserves fallback topic metadata on summary cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [makeMeetingEntity({ id: 'topic-1', type: 'topic' })],
      fallbackActionItems: [
        'Send pricing recap (Topic: Pricing rollout | Owner: Alex | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'fallback-0',
        title: 'Send pricing recap',
        status: 'fallback',
        statusLabel: null,
        topicLabel: 'Pricing rollout',
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        dismissLabel: null,
        snoozeLabel: null,
        isBlocked: false,
        blockerReason: null,
        attentionKindLabel: null,
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
          kind: 'follow_up',
          status: 'active',
          related_entity_ids: ['active-follow-up'],
        },
        {
          id: 'attention-dismissed',
          kind: 'blocker',
          status: 'dismissed',
          related_entity_ids: ['dismissed-follow-up'],
        },
        {
          id: 'attention-snoozed',
          kind: 'stale_context',
          status: 'snoozed',
          related_entity_ids: ['snoozed-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items[0]).toMatchObject({
      id: 'active-follow-up',
      attentionItemId: 'attention-active',
      attentionKindLabel: 'Follow-up',
      attentionStatus: 'active',
      dismissLabel: 'Dismiss',
      snoozeLabel: 'Snooze',
    });
    expect(items[1]).toMatchObject({
      id: 'snoozed-follow-up',
      attentionItemId: 'attention-snoozed',
      attentionKindLabel: 'Stale context',
      attentionStatus: 'snoozed',
      dismissLabel: null,
      snoozeLabel: 'Reopen',
      actionable: true,
    });
    expect(items[2]).toMatchObject({
      id: 'dismissed-follow-up',
      attentionItemId: 'attention-dismissed',
      attentionKindLabel: 'Blocker',
      attentionStatus: 'dismissed',
      dismissLabel: 'Reopen',
      snoozeLabel: null,
      actionable: false,
    });
  });

  it('prefers an active linked attention item over dismissed duplicates for the same follow-up', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'mixed-status-follow-up',
          name: 'Send partner recap',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-dismissed',
          kind: 'follow_up',
          status: 'dismissed',
          related_entity_ids: ['mixed-status-follow-up'],
        },
        {
          id: 'attention-active-blocker',
          kind: 'blocker',
          reason: 'Waiting on legal approval.',
          status: 'active',
          related_entity_ids: ['mixed-status-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'mixed-status-follow-up',
        attentionItemId: 'attention-active-blocker',
        attentionKindLabel: 'Blocker',
        attentionStatus: 'active',
        actionable: true,
        dismissLabel: 'Dismiss blocker',
        snoozeLabel: 'Snooze blocker',
        isBlocked: true,
        blockerReason: 'Waiting on legal approval.',
      }),
    ]);
  });

  it('preserves fallback metadata when linked action entities are sparser', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'action-1',
          name: 'Send pricing recap',
          assigned_to: null,
          due_date: null,
          context: 'Waiting on legal sign-off.',
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Status: Needs legal review | Owner: Alex | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'action-1',
        title: 'Send pricing recap',
        status: 'active',
        statusLabel: 'Needs legal review',
        topicLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due Friday',
        context: 'Waiting on legal sign-off.',
        isBlocked: false,
        blockerReason: null,
        actionable: true,
        toggleLabel: 'Mark complete',
        attentionItemId: null,
        attentionStatus: null,
        attentionKindLabel: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
    ]);
  });

  it('uses the completed affordance when fallback lifecycle upgrades a linked card to completed', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'action-completed-by-fallback',
          name: 'Send pricing recap',
          status: 'active',
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Status: Completed | Owner: Alex | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'action-completed-by-fallback',
        title: 'Send pricing recap',
        status: 'completed',
        statusLabel: null,
        topicLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due May 30',
        context: 'Alex committed to send the pricing recap by Friday.',
        isBlocked: false,
        blockerReason: null,
        actionable: true,
        toggleLabel: 'Reopen',
        attentionItemId: null,
        attentionStatus: null,
        attentionKindLabel: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
    ]);
  });

  it('preserves unmatched fallback cards alongside linked action items', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'linked-1',
          name: 'Send pricing recap',
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Owner: Alex | Due: Friday)',
        'Confirm reseller terms (Status: Needs legal review | Context: Waiting on contract redlines.)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'linked-1',
        title: 'Send pricing recap',
        status: 'active',
        statusLabel: null,
        topicLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due May 30',
        context: 'Alex committed to send the pricing recap by Friday.',
        isBlocked: false,
        blockerReason: null,
        actionable: true,
        toggleLabel: 'Mark complete',
        attentionItemId: null,
        attentionStatus: null,
        attentionKindLabel: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
      {
        id: 'fallback-1',
        title: 'Confirm reseller terms',
        status: 'fallback',
        statusLabel: 'Needs legal review',
        topicLabel: null,
        assignee: null,
        dueLabel: null,
        context: 'Waiting on contract redlines.',
        isBlocked: false,
        blockerReason: null,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        attentionKindLabel: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
    ]);
  });

  it('prioritizes overdue and stale fallback cards ahead of routine active linked work', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'linked-active',
          name: 'Send pricing recap',
          mention_count: 5,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'linked-completed',
          name: 'Archive prior draft',
          status: 'completed',
          mention_count: 1,
          created_at: '2026-05-24T18:00:00.000Z',
        }),
      ],
      fallbackActionItems: [
        'Confirm reseller terms (Status: Overdue | Context: Waiting on contract redlines.)',
        'Review onboarding notes (Status: Stale | Context: The notes have not been revisited since the kickoff.)',
      ],
    });

    expect(items.map((item) => [item.title, item.status])).toEqual([
      ['Confirm reseller terms', 'overdue'],
      ['Review onboarding notes', 'stale'],
      ['Send pricing recap', 'active'],
      ['Archive prior draft', 'completed'],
    ]);
  });

  it('preserves blocker attention context for linked action cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'blocked-follow-up',
          name: 'Confirm launch plan',
          context: 'The team is waiting on legal before launch can proceed.',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-blocked',
          kind: 'blocker',
          reason: 'Legal approval is still blocking launch readiness.',
          status: 'active',
          related_entity_ids: ['blocked-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'blocked-follow-up',
        attentionItemId: 'attention-blocked',
        attentionStatus: 'active',
        actionable: true,
        dismissLabel: 'Dismiss blocker',
        snoozeLabel: 'Snooze blocker',
        isBlocked: true,
        blockerReason: 'Legal approval is still blocking launch readiness.',
      }),
    ]);
  });

  it('prefers the richer blocker reason when duplicate active blockers target one follow-up', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'blocked-follow-up',
          name: 'Confirm launch plan',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-blocked-thin',
          kind: 'blocker',
          reason: 'Legal approval.',
          status: 'active',
          related_entity_ids: ['blocked-follow-up'],
        },
        {
          id: 'attention-blocked-rich',
          kind: 'blocker',
          reason: 'Legal approval is still blocking launch readiness.',
          status: 'active',
          related_entity_ids: ['blocked-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'blocked-follow-up',
        attentionItemId: 'attention-blocked-rich',
        attentionStatus: 'active',
        isBlocked: true,
        blockerReason: 'Legal approval is still blocking launch readiness.',
      }),
    ]);
  });

  it('preserves fallback blocker context and prioritizes blocked fallback cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'routine-active',
          name: 'Send pricing recap',
          mention_count: 5,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
      ],
      fallbackActionItems: [
        'Confirm reseller terms (Status: Blocked on legal review | Context: Waiting on contract redlines.)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'fallback-0',
        title: 'Confirm reseller terms',
        status: 'active',
        statusLabel: null,
        topicLabel: null,
        attentionKindLabel: 'Blocker',
        assignee: null,
        dueLabel: null,
        context: 'Waiting on contract redlines.',
        isBlocked: true,
        blockerReason: 'legal review',
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
      expect.objectContaining({
        id: 'routine-active',
        status: 'active',
        isBlocked: false,
      }),
    ]);
  });

  it('resolves linked action owners from meeting people entities and falls back to raw owner strings when missing', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'person-owned-follow-up',
          name: 'Send rollout email',
          assigned_to: 'person-1',
        }),
        makeMeetingEntity({
          id: 'raw-owned-follow-up',
          name: 'Confirm reseller terms',
          assigned_to: 'person-404',
        }),
        makeMeetingEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          normalized_name: 'sarah chen',
          status: null,
          due_date: null,
          assigned_to: null,
          mention_count: 3,
          context: 'Role: Head of Product',
        }),
      ],
      fallbackActionItems: [],
    });

    expect(items[0]).toMatchObject({
      id: 'person-owned-follow-up',
      assignee: 'Sarah Chen',
    });
    expect(items[1]).toMatchObject({
      id: 'raw-owned-follow-up',
      assignee: 'person-404',
    });
  });

  it('preserves fallback topic detail on matching linked action cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'action-1',
          name: 'Send pricing recap',
          assigned_to: 'Alex',
          due_date: '2026-05-30T15:00:00.000Z',
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Topic: Pricing strategy | Owner: Alex | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      {
        id: 'action-1',
        title: 'Send pricing recap',
        topicLabel: 'Pricing strategy',
        status: 'active',
        statusLabel: null,
        assignee: 'Alex',
        dueLabel: 'Due May 30',
        context: 'Alex committed to send the pricing recap by Friday.',
        isBlocked: false,
        blockerReason: null,
        actionable: true,
        toggleLabel: 'Mark complete',
        attentionItemId: null,
        attentionStatus: null,
        attentionKindLabel: null,
        dismissLabel: null,
        snoozeLabel: null,
      },
    ]);
  });

  it('preserves richer fallback owner-role detail on matching linked action cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'action-1',
          name: 'Send pricing recap',
          assigned_to: 'person-1',
        }),
        makeMeetingEntity({
          id: 'person-1',
          type: 'person',
          name: 'Sarah Chen',
          normalized_name: 'sarah chen',
          status: null,
          due_date: null,
          assigned_to: null,
          mention_count: 3,
          context: 'Role: Head of Product',
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Owner: Sarah Chen (Head of Product) | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'action-1',
        assignee: 'Sarah Chen (Head of Product)',
        dueLabel: 'Due May 30',
      }),
    ]);
  });

  it('keeps the linked owner label when a longer fallback owner string refers to a different person', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'action-1',
          name: 'Send pricing recap',
          assigned_to: 'Alex',
          due_date: null,
          context: null,
        }),
      ],
      fallbackActionItems: [
        'Send pricing recap (Owner: Alex Rivera (Head of Product) | Due: Friday)',
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'action-1',
        assignee: 'Alex',
        dueLabel: 'Due Friday',
      }),
    ]);
  });

  it('prioritizes blocker-backed active follow-ups ahead of routine active cards', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'routine-active',
          name: 'Send routine recap',
          mention_count: 5,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'blocked-active',
          name: 'Unblock launch approval',
          mention_count: 1,
          created_at: '2026-05-25T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'stale-follow-up',
          name: 'Confirm archived notes',
          status: 'stale',
          mention_count: 3,
          created_at: '2026-05-27T18:00:00.000Z',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-blocker',
          kind: 'blocker',
          status: 'active',
          related_entity_ids: ['blocked-active'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items.map((item) => item.id)).toEqual([
      'blocked-active',
      'stale-follow-up',
      'routine-active',
    ]);
  });

  it('prefers blocker attention over routine active duplicates for the same follow-up', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'shared-follow-up',
          name: 'Unblock legal review',
          mention_count: 1,
          created_at: '2026-05-25T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'routine-active',
          name: 'Send routine recap',
          mention_count: 5,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
      ],
      linkedAttentionItems: [
        {
          id: 'attention-shared-follow-up',
          kind: 'follow_up',
          status: 'active',
          related_entity_ids: ['shared-follow-up'],
        },
        {
          id: 'attention-shared-blocker',
          kind: 'blocker',
          status: 'active',
          reason: 'Waiting on legal approval.',
          related_entity_ids: ['shared-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items.map((item) => item.id)).toEqual([
      'shared-follow-up',
      'routine-active',
    ]);
    expect(items[0]).toMatchObject({
      id: 'shared-follow-up',
      attentionItemId: 'attention-shared-blocker',
      attentionKindLabel: 'Blocker',
      attentionStatus: 'active',
      isBlocked: true,
      blockerReason: 'Waiting on legal approval.',
      dismissLabel: 'Dismiss blocker',
      snoozeLabel: 'Snooze blocker',
    });
  });

  it('deprioritizes dismissed and snoozed linked follow-ups behind active work', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'dismissed-follow-up',
          name: 'Archive stale task',
          mention_count: 5,
          created_at: '2026-05-28T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'snoozed-follow-up',
          name: 'Revisit partner sync',
          mention_count: 4,
          created_at: '2026-05-27T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'active-follow-up',
          name: 'Send updated launch plan',
          mention_count: 1,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
      ],
      linkedAttentionItems: [
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
        {
          id: 'attention-active',
          status: 'active',
          related_entity_ids: ['active-follow-up'],
        },
      ],
      fallbackActionItems: [],
    });

    expect(items.map((item) => item.id)).toEqual([
      'active-follow-up',
      'snoozed-follow-up',
      'dismissed-follow-up',
    ]);
  });

  it('prioritizes overdue and stale linked follow-ups ahead of routine active work', () => {
    const items = buildMeetingActionItems({
      meetingEntities: [
        makeMeetingEntity({
          id: 'active-follow-up',
          name: 'Send routine notes',
          status: 'active',
          mention_count: 4,
          created_at: '2026-05-28T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'stale-follow-up',
          name: 'Revisit old pricing blocker',
          status: 'stale',
          mention_count: 1,
          created_at: '2026-05-26T18:00:00.000Z',
        }),
        makeMeetingEntity({
          id: 'overdue-follow-up',
          name: 'Send overdue contract redlines',
          status: 'overdue',
          mention_count: 1,
          created_at: '2026-05-25T18:00:00.000Z',
        }),
      ],
      fallbackActionItems: [],
    });

    expect(items.map((item) => item.id)).toEqual([
      'overdue-follow-up',
      'stale-follow-up',
      'active-follow-up',
    ]);
  });
});
