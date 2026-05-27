import type { Entity } from '../../api/knowledgeGraph';

export type MeetingActionEntity = Entity & {
  mention_count: number;
  context: string | null;
};

export type MeetingActionItemStatus =
  | 'active'
  | 'completed'
  | 'stale'
  | 'overdue'
  | 'fallback';

export type MeetingActionDismissalState = 'active' | 'dismissed' | null;

export interface MeetingLinkedAttentionItem {
  id: string;
  status: 'active' | 'dismissed';
  related_entity_ids: string[];
}

export interface MeetingActionItemCard {
  id: string;
  title: string;
  status: MeetingActionItemStatus;
  assignee: string | null;
  dueLabel: string | null;
  context: string | null;
  actionable: boolean;
  toggleLabel: 'Mark complete' | 'Reopen' | null;
  attentionItemId: string | null;
  dismissalState: MeetingActionDismissalState;
  dismissalLabel: 'Dismiss' | 'Reopen' | null;
}

interface BuildMeetingActionItemsParams {
  meetingEntities: MeetingActionEntity[];
  linkedAttentionItems?: MeetingLinkedAttentionItem[];
  fallbackActionItems: string[];
}

const ACTION_STATUS_ORDER: Record<
  Exclude<MeetingActionItemStatus, 'fallback'>,
  number
> = {
  active: 0,
  overdue: 1,
  stale: 2,
  completed: 3,
};

const formatDueLabel = (dueDate: string | null): string | null => {
  if (!dueDate) return null;
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed
    .toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    })
    .replace(/^/, 'Due ');
};

const sortMeetingActionEntities = (
  left: MeetingActionEntity,
  right: MeetingActionEntity,
): number => {
  const leftStatus = left.status ?? 'active';
  const rightStatus = right.status ?? 'active';
  const leftRank =
    ACTION_STATUS_ORDER[leftStatus] ?? ACTION_STATUS_ORDER.active;
  const rightRank =
    ACTION_STATUS_ORDER[rightStatus] ?? ACTION_STATUS_ORDER.active;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.mention_count !== right.mention_count) {
    return right.mention_count - left.mention_count;
  }
  return (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
};

export const buildMeetingActionItems = ({
  meetingEntities,
  linkedAttentionItems = [],
  fallbackActionItems,
}: BuildMeetingActionItemsParams): MeetingActionItemCard[] => {
  const attentionByEntityId = new Map<
    string,
    Pick<MeetingLinkedAttentionItem, 'id' | 'status'>
  >();

  for (const item of linkedAttentionItems) {
    for (const relatedEntityId of item.related_entity_ids) {
      if (attentionByEntityId.has(relatedEntityId)) continue;
      attentionByEntityId.set(relatedEntityId, {
        id: item.id,
        status: item.status,
      });
    }
  }

  const linkedActionItems = meetingEntities
    .filter(
      (entity): entity is MeetingActionEntity =>
        entity.type === 'action_item' && entity.name.trim().length > 0,
    )
    .sort(sortMeetingActionEntities)
    .map((entity) => {
      const status = entity.status ?? 'active';
      const linkedAttention = attentionByEntityId.get(entity.id);
      const dismissalState = linkedAttention?.status ?? null;
      return {
        id: entity.id,
        title: entity.name,
        status,
        assignee: entity.assigned_to,
        dueLabel: formatDueLabel(entity.due_date),
        context: entity.context,
        actionable: dismissalState !== 'dismissed',
        toggleLabel: status === 'completed' ? 'Reopen' : 'Mark complete',
        attentionItemId: linkedAttention?.id ?? null,
        dismissalState,
        dismissalLabel:
          dismissalState === null
            ? null
            : dismissalState === 'dismissed'
              ? 'Reopen'
              : 'Dismiss',
      } satisfies MeetingActionItemCard;
    });

  if (linkedActionItems.length > 0) {
    return linkedActionItems;
  }

  return fallbackActionItems
    .map((item, index) => ({
      id: `fallback-${index}`,
      title: item.trim(),
      status: 'fallback' as const,
      assignee: null,
      dueLabel: null,
      context: null,
      actionable: false,
      toggleLabel: null,
      attentionItemId: null,
      dismissalState: null,
      dismissalLabel: null,
    }))
    .filter((item) => item.title.length > 0);
};
