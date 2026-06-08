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

export type MeetingActionAttentionStatus =
  | 'active'
  | 'dismissed'
  | 'snoozed'
  | null;

export interface MeetingLinkedAttentionItem {
  id: string;
  kind?: string;
  reason?: string;
  status: 'active' | 'dismissed' | 'snoozed';
  related_entity_ids: string[];
}

export interface MeetingActionItemCard {
  id: string;
  title: string;
  status: MeetingActionItemStatus;
  statusLabel: string | null;
  topicLabel: string | null;
  assignee: string | null;
  dueLabel: string | null;
  context: string | null;
  actionable: boolean;
  toggleLabel: 'Mark complete' | 'Reopen' | null;
  attentionItemId: string | null;
  attentionStatus: MeetingActionAttentionStatus;
  dismissLabel: 'Dismiss' | 'Reopen' | null;
  snoozeLabel: 'Snooze' | 'Reopen' | null;
}

interface BuildMeetingActionItemsParams {
  meetingEntities: MeetingActionEntity[];
  linkedAttentionItems?: MeetingLinkedAttentionItem[];
  fallbackActionItems: string[];
}

interface ParsedFallbackActionItem {
  title: string;
  status: MeetingActionItemStatus;
  statusLabel: string | null;
  topicLabel: string | null;
  assignee: string | null;
  dueLabel: string | null;
  context: string | null;
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

const normalizeValue = (value: string | null | undefined): string =>
  (value || '').trim();

const parseFallbackStatus = (
  value: string,
): Pick<ParsedFallbackActionItem, 'status' | 'statusLabel'> => {
  const normalized = normalizeValue(value);
  const lowered = normalized.toLowerCase();
  if (lowered === 'overdue') {
    return { status: 'overdue', statusLabel: null };
  }
  if (lowered === 'stale') {
    return { status: 'stale', statusLabel: null };
  }
  if (lowered === 'completed') {
    return { status: 'completed', statusLabel: null };
  }
  if (lowered === 'active' || !normalized) {
    return { status: 'fallback', statusLabel: null };
  }
  return { status: 'fallback', statusLabel: normalized };
};

const parseFallbackActionItem = (value: string): ParsedFallbackActionItem => {
  const trimmed = normalizeValue(value);
  const match = trimmed.match(/^(.*?)(?: \((.+)\))?$/);
  if (!match) {
    return {
      title: trimmed,
      status: 'fallback',
      statusLabel: null,
      topicLabel: null,
      assignee: null,
      dueLabel: null,
      context: null,
    };
  }

  const [, rawTitle, rawDetailText] = match;
  const parsed: ParsedFallbackActionItem = {
    title: normalizeValue(rawTitle),
    status: 'fallback',
    statusLabel: null,
    topicLabel: null,
    assignee: null,
    dueLabel: null,
    context: null,
  };

  if (!rawDetailText) {
    return parsed;
  }

  for (const detail of rawDetailText.split('|')) {
    const normalized = normalizeValue(detail);
    const lowered = normalized.toLowerCase();
    if (lowered.startsWith('topic:')) {
      parsed.topicLabel = normalizeValue(normalized.slice('topic:'.length));
      continue;
    }
    if (lowered.startsWith('owner:')) {
      parsed.assignee = normalizeValue(normalized.slice('owner:'.length));
      continue;
    }
    if (lowered.startsWith('due:')) {
      const dueValue = normalizeValue(normalized.slice('due:'.length));
      parsed.dueLabel = dueValue ? `Due ${dueValue}` : null;
      continue;
    }
    if (lowered.startsWith('context:')) {
      parsed.context = normalizeValue(normalized.slice('context:'.length));
      continue;
    }
    if (lowered.startsWith('status:')) {
      const statusValue = parseFallbackStatus(
        normalizeValue(normalized.slice('status:'.length)),
      );
      parsed.status = statusValue.status;
      parsed.statusLabel = statusValue.statusLabel;
    }
  }

  return parsed;
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
      return {
        id: entity.id,
        title: entity.name,
        status,
        statusLabel: null,
        topicLabel: null,
        assignee: entity.assigned_to,
        dueLabel: formatDueLabel(entity.due_date),
        context: entity.context,
        actionable: linkedAttention?.status !== 'dismissed',
        toggleLabel: status === 'completed' ? 'Reopen' : 'Mark complete',
        attentionItemId: linkedAttention?.id ?? null,
        attentionStatus: linkedAttention?.status ?? null,
        dismissLabel:
          linkedAttention == null
            ? null
            : linkedAttention.status === 'dismissed'
              ? 'Reopen'
              : linkedAttention.status === 'snoozed'
                ? null
                : 'Dismiss',
        snoozeLabel:
          linkedAttention == null
            ? null
            : linkedAttention.status === 'dismissed'
              ? null
              : linkedAttention.status === 'snoozed'
                ? 'Reopen'
                : 'Snooze',
      } satisfies MeetingActionItemCard;
    });

  if (linkedActionItems.length > 0) {
    return linkedActionItems;
  }

  return fallbackActionItems
    .map((item, index) => {
      const parsed = parseFallbackActionItem(item);
      return {
        id: `fallback-${index}`,
        title: parsed.title,
        status: parsed.status,
        statusLabel: parsed.statusLabel,
        topicLabel: parsed.topicLabel,
        assignee: parsed.assignee,
        dueLabel: parsed.dueLabel,
        context: parsed.context,
        actionable: false,
        toggleLabel: null,
        attentionItemId: null,
        attentionStatus: null,
        dismissLabel: null,
        snoozeLabel: null,
      } satisfies MeetingActionItemCard;
    })
    .filter((item) => item.title.length > 0);
};
