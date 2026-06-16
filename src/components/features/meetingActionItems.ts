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
  attentionKindLabel: string | null;
  assignee: string | null;
  dueLabel: string | null;
  context: string | null;
  isBlocked: boolean;
  blockerReason: string | null;
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
  attentionKindLabel: string | null;
  assignee: string | null;
  dueLabel: string | null;
  context: string | null;
  isBlocked: boolean;
  blockerReason: string | null;
}

type LinkedMeetingActionItemCard = Omit<
  MeetingActionItemCard,
  'status' | 'statusLabel'
> & {
  status: Exclude<MeetingActionItemStatus, 'fallback'>;
  statusLabel: string | null;
};

const ACTION_STATUS_ORDER: Record<
  Exclude<MeetingActionItemStatus, 'fallback'>,
  number
> = {
  overdue: 0,
  stale: 1,
  active: 2,
  completed: 3,
};

const ATTENTION_STATUS_ORDER: Record<
  NonNullable<MeetingActionAttentionStatus>,
  number
> = {
  active: 0,
  snoozed: 1,
  dismissed: 2,
};

const getMeetingActionItemRank = (status: MeetingActionItemStatus): number => {
  if (status === 'fallback') return 4;
  return ACTION_STATUS_ORDER[status];
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

const ATTENTION_KIND_LABELS: Record<string, string> = {
  follow_up: 'Follow-up',
  blocker: 'Blocker',
  risk: 'Risk',
  dependency: 'Dependency',
  open_question: 'Open question',
  stale_context: 'Stale context',
  repeated_pattern: 'Pattern',
  decision_conflict: 'Decision conflict',
  duplicate_commitment: 'Duplicate commitment',
  reference_context: 'Reference context',
  source_quality: 'Source quality',
};

const formatAttentionKindLabel = (kind: string | undefined): string | null => {
  const normalized = (kind || '').trim();
  if (!normalized) return null;
  return ATTENTION_KIND_LABELS[normalized] ?? null;
};

const normalizeValue = (value: string | null | undefined): string =>
  (value || '').trim();

const normalizeActionKey = (value: string | null | undefined): string =>
  normalizeValue(value).toLowerCase();

const parseOwnerLabel = (
  value: string | null | undefined,
): { name: string; role: string } => {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return { name: '', role: '' };
  }

  const match = normalized.match(/^(.*?)\s+\((.+)\)$/);
  if (!match) {
    return { name: normalized, role: '' };
  }

  return {
    name: normalizeValue(match[1]),
    role: normalizeValue(match[2]),
  };
};

const preferRicherOwnerLabel = (
  primary: string | null,
  fallback: string | null,
): string | null => {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const normalizedPrimary = normalizeValue(primary);
  const normalizedFallback = normalizeValue(fallback);
  if (!normalizedPrimary) return normalizedFallback || null;
  if (!normalizedFallback) return normalizedPrimary;

  const primaryOwner = parseOwnerLabel(normalizedPrimary);
  const fallbackOwner = parseOwnerLabel(normalizedFallback);

  if (
    primaryOwner.name &&
    fallbackOwner.name &&
    normalizeActionKey(primaryOwner.name) ===
      normalizeActionKey(fallbackOwner.name) &&
    normalizedFallback.length > normalizedPrimary.length &&
    (!primaryOwner.role || fallbackOwner.role)
  ) {
    return normalizedFallback;
  }

  return normalizedPrimary;
};

const parseFallbackStatus = (
  value: string,
): Pick<
  ParsedFallbackActionItem,
  'status' | 'statusLabel' | 'attentionKindLabel' | 'isBlocked' | 'blockerReason'
> => {
  const normalized = normalizeValue(value);
  const lowered = normalized.toLowerCase();
  if (lowered === 'overdue') {
    return {
      status: 'overdue',
      statusLabel: null,
      attentionKindLabel: null,
      isBlocked: false,
      blockerReason: null,
    };
  }
  if (lowered === 'stale') {
    return {
      status: 'stale',
      statusLabel: null,
      attentionKindLabel: null,
      isBlocked: false,
      blockerReason: null,
    };
  }
  if (lowered === 'completed') {
    return {
      status: 'completed',
      statusLabel: null,
      attentionKindLabel: null,
      isBlocked: false,
      blockerReason: null,
    };
  }
  const blockedMatch = normalized.match(
    /^blocked(?:\s+(?:on|by|due to|because of))?[:\-\s]*(.*)$/i,
  );
  if (blockedMatch) {
    return {
      status: 'active',
      statusLabel: null,
      attentionKindLabel: 'Blocker',
      isBlocked: true,
      blockerReason: normalizeValue(blockedMatch[1]) || null,
    };
  }
  if (lowered === 'active' || !normalized) {
    return {
      status: 'fallback',
      statusLabel: null,
      attentionKindLabel: null,
      isBlocked: false,
      blockerReason: null,
    };
  }
  return {
    status: 'fallback',
    statusLabel: normalized,
    attentionKindLabel: null,
    isBlocked: false,
    blockerReason: null,
  };
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
      attentionKindLabel: null,
      assignee: null,
      dueLabel: null,
      context: null,
      isBlocked: false,
      blockerReason: null,
    };
  }

  const [, rawTitle, rawDetailText] = match;
  const parsed: ParsedFallbackActionItem = {
    title: normalizeValue(rawTitle),
    status: 'fallback',
    statusLabel: null,
    topicLabel: null,
    attentionKindLabel: null,
    assignee: null,
    dueLabel: null,
    context: null,
    isBlocked: false,
    blockerReason: null,
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
      parsed.attentionKindLabel = statusValue.attentionKindLabel;
      parsed.isBlocked = statusValue.isBlocked;
      parsed.blockerReason = statusValue.blockerReason;
    }
  }

  return parsed;
};

const sortMeetingActionEntities = (
  left: MeetingActionEntity,
  right: MeetingActionEntity,
  attentionByEntityId: Map<
    string,
    Pick<MeetingLinkedAttentionItem, 'id' | 'status' | 'kind' | 'reason'>
  >,
): number => {
  const leftStatus = left.status ?? 'active';
  const rightStatus = right.status ?? 'active';
  const leftIsActiveBlocker =
    leftStatus === 'active' &&
    attentionByEntityId.get(left.id)?.kind === 'blocker' &&
    attentionByEntityId.get(left.id)?.status === 'active';
  const rightIsActiveBlocker =
    rightStatus === 'active' &&
    attentionByEntityId.get(right.id)?.kind === 'blocker' &&
    attentionByEntityId.get(right.id)?.status === 'active';

  if (leftIsActiveBlocker !== rightIsActiveBlocker) {
    return leftIsActiveBlocker ? -1 : 1;
  }

  const leftRank =
    ACTION_STATUS_ORDER[leftStatus] ?? ACTION_STATUS_ORDER.active;
  const rightRank =
    ACTION_STATUS_ORDER[rightStatus] ?? ACTION_STATUS_ORDER.active;
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftAttentionStatus =
    attentionByEntityId.get(left.id)?.status ?? 'active';
  const rightAttentionStatus =
    attentionByEntityId.get(right.id)?.status ?? 'active';
  const leftAttentionRank =
    ATTENTION_STATUS_ORDER[leftAttentionStatus] ??
    ATTENTION_STATUS_ORDER.active;
  const rightAttentionRank =
    ATTENTION_STATUS_ORDER[rightAttentionStatus] ??
    ATTENTION_STATUS_ORDER.active;
  if (leftAttentionRank !== rightAttentionRank) {
    return leftAttentionRank - rightAttentionRank;
  }

  if (left.mention_count !== right.mention_count) {
    return right.mention_count - left.mention_count;
  }
  return (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
};

const mergeLinkedAndFallbackActionItem = (
  linked: LinkedMeetingActionItemCard,
  fallback?: ParsedFallbackActionItem,
): MeetingActionItemCard => {
  if (!fallback) {
    return linked;
  }

  const shouldUseFallbackLifecycle =
    linked.status === 'active' &&
    (fallback.status === 'overdue' ||
      fallback.status === 'stale' ||
      fallback.status === 'completed');
  const mergedStatus = shouldUseFallbackLifecycle
    ? fallback.status
    : linked.status;

  return {
    ...linked,
    status: mergedStatus,
    statusLabel: linked.statusLabel ?? fallback.statusLabel,
    topicLabel: linked.topicLabel ?? fallback.topicLabel,
    attentionKindLabel:
      linked.attentionKindLabel ?? fallback.attentionKindLabel,
    assignee: preferRicherOwnerLabel(linked.assignee, fallback.assignee),
    dueLabel: linked.dueLabel ?? fallback.dueLabel,
    context: linked.context ?? fallback.context,
    isBlocked: linked.isBlocked || fallback.isBlocked,
    blockerReason: linked.blockerReason ?? fallback.blockerReason,
    toggleLabel: mergedStatus === 'completed' ? 'Reopen' : 'Mark complete',
  };
};

export const buildMeetingActionItems = ({
  meetingEntities,
  linkedAttentionItems = [],
  fallbackActionItems,
}: BuildMeetingActionItemsParams): MeetingActionItemCard[] => {
  const peopleById = new Map(
    meetingEntities
      .filter(
        (entity): entity is MeetingActionEntity =>
          entity.type === 'person' && entity.name.trim().length > 0,
      )
      .map((entity) => [entity.id, entity.name] as const),
  );
  const fallbackByTitle = new Map<string, ParsedFallbackActionItem>();
  for (const item of fallbackActionItems) {
    const parsed = parseFallbackActionItem(item);
    const key = normalizeActionKey(parsed.title);
    if (!key || fallbackByTitle.has(key)) continue;
    fallbackByTitle.set(key, parsed);
  }

  const attentionByEntityId = new Map<
    string,
    Pick<MeetingLinkedAttentionItem, 'id' | 'status' | 'kind' | 'reason'>
  >();

  for (const item of linkedAttentionItems) {
    for (const relatedEntityId of item.related_entity_ids) {
      if (attentionByEntityId.has(relatedEntityId)) continue;
      attentionByEntityId.set(relatedEntityId, {
        id: item.id,
        status: item.status,
        kind: item.kind,
        reason: item.reason,
      });
    }
  }

  const linkedActionItems = meetingEntities
    .filter(
      (entity): entity is MeetingActionEntity =>
        entity.type === 'action_item' && entity.name.trim().length > 0,
    )
    .sort((left, right) =>
      sortMeetingActionEntities(left, right, attentionByEntityId),
    )
    .map((entity) => {
      const status = entity.status ?? 'active';
      const linkedAttention = attentionByEntityId.get(entity.id);
      const isBlocked = linkedAttention?.kind === 'blocker';
      return mergeLinkedAndFallbackActionItem(
        {
          id: entity.id,
          title: entity.name,
          status,
          statusLabel: null,
          topicLabel: null,
          attentionKindLabel: formatAttentionKindLabel(linkedAttention?.kind),
          assignee: entity.assigned_to
            ? (peopleById.get(entity.assigned_to) ?? entity.assigned_to)
            : null,
          dueLabel: formatDueLabel(entity.due_date),
          context: entity.context,
          isBlocked,
          blockerReason: isBlocked ? (linkedAttention?.reason ?? null) : null,
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
        },
        fallbackByTitle.get(normalizeActionKey(entity.name)),
      );
    });

  const linkedActionKeys = new Set(
    linkedActionItems.map((item) => normalizeValue(item.title).toLowerCase()),
  );
  const fallbackOnlyItems = fallbackActionItems
    .map((item, index) => {
      const parsed = parseFallbackActionItem(item);
      return { parsed, index };
    })
    .filter(({ parsed }) => parsed.title.length > 0)
    .filter(
      ({ parsed }) =>
        !linkedActionKeys.has(normalizeValue(parsed.title).toLowerCase()),
    )
    .map(({ parsed, index }) => ({
      id: `fallback-${index}`,
      title: parsed.title,
      status: parsed.status,
      statusLabel: parsed.statusLabel,
      topicLabel: parsed.topicLabel,
      attentionKindLabel: parsed.attentionKindLabel,
      assignee: parsed.assignee,
      dueLabel: parsed.dueLabel,
      context: parsed.context,
      isBlocked: parsed.isBlocked,
      blockerReason: parsed.blockerReason,
      actionable: false,
      toggleLabel: null,
      attentionItemId: null,
      attentionStatus: null,
      dismissLabel: null,
      snoozeLabel: null,
    }));

  return [...linkedActionItems, ...fallbackOnlyItems]
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftIsActiveBlocker =
        left.item.status === 'active' &&
        left.item.isBlocked &&
        left.item.attentionStatus !== 'dismissed' &&
        left.item.attentionStatus !== 'snoozed';
      const rightIsActiveBlocker =
        right.item.status === 'active' &&
        right.item.isBlocked &&
        right.item.attentionStatus !== 'dismissed' &&
        right.item.attentionStatus !== 'snoozed';

      if (leftIsActiveBlocker !== rightIsActiveBlocker) {
        return leftIsActiveBlocker ? -1 : 1;
      }

      const leftRank = getMeetingActionItemRank(left.item.status);
      const rightRank = getMeetingActionItemRank(right.item.status);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
};
