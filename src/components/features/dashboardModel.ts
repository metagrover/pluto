import type { WorkingMemorySnapshot } from '../../../electron/db';
import type { AttentionItem } from '../../../electron/intelligence/intelligenceTypes';
import type { KnowledgeDoc } from '../../api/knowledgeDocs';
import type { Entity, KnowledgeGraphStats } from '../../api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../api/knowledgeWorkspace';
import type { Meeting } from '../../types';
import type { TrustStatus } from '../../utils/trustStatus';
import {
  deriveKnowledgeTrustStatus,
  getTrustStatusMeta,
} from '../../utils/trustStatus';
import {
  compileKnowledgeBrief,
  matchesWorkingMemorySnapshotToDoc,
  parseStructuredKnowledgeV2Doc,
} from '../KnowledgeGraph/knowledgeDocument';

export type DashboardTarget = 'ask' | 'meeting' | 'projects' | 'wiki';

export type DashboardAction =
  | {
      label: string;
      target: 'meeting';
      meetingId: Meeting['id'];
    }
  | {
      label: string;
      target: Exclude<DashboardTarget, 'meeting'>;
    };

export type DashboardHeroKind =
  | 'recording'
  | 'overdue_action'
  | 'stale_action'
  | 'active_action'
  | 'latest_meeting'
  | 'knowledge_doc'
  | 'default';

export interface DashboardHero {
  kind: DashboardHeroKind;
  label: string;
  title: string;
  detail: string;
  severity: 'live' | 'urgent' | 'watch' | 'calm';
  action?: DashboardAction;
}

export type DashboardLatestMeeting =
  | {
      state: 'empty';
      title: string;
      detail: string;
    }
  | {
      state: 'populated';
      meetingId: Meeting['id'];
      title: string;
      detail: string;
      occurredAt: string;
    };

export interface DashboardActionInsightItem {
  id: string;
  title: string;
  dueLabel: string;
  status: 'overdue' | 'stale' | 'active';
  sourceLabel: string;
  contextLabel: string | null;
  attentionLabel: string | null;
  attentionReason: string | null;
  attentionItemId: string | null;
  attentionStatus: AttentionItem['status'] | null;
  dismissLabel: 'Dismiss' | 'Dismiss blocker' | 'Reopen' | null;
  snoozeLabel: 'Snooze' | 'Snooze blocker' | 'Reopen' | null;
}

export type DashboardActionInsights =
  | {
      state: 'empty';
      overdueCount: 0;
      staleCount: 0;
      activeCount: 0;
      items: [];
    }
  | {
      state: 'populated';
      overdueCount: number;
      staleCount: number;
      activeCount: number;
      items: DashboardActionInsightItem[];
    };

export interface DashboardKnowledgeDocumentCard {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  sourceCountLabel: string;
  status: KnowledgeDoc['status'];
  scopeType: KnowledgeDoc['scope_type'];
  trustStatus: TrustStatus | null;
  trustDescription: string | null;
}

export type DashboardKnowledgeDocuments =
  | {
      state: 'empty';
      cards: [];
    }
  | {
      state: 'populated';
      cards: DashboardKnowledgeDocumentCard[];
    };

export interface DashboardSpotlight {
  title: string;
  subtitle: string;
  badgeLabel: string;
  detail: string;
  tags: string[];
  hasBlockers: boolean;
  target: DashboardTarget;
}

export type DashboardBriefingFocusKind =
  | 'attention'
  | 'latest_meeting'
  | 'knowledge_doc'
  | 'empty';

export interface DashboardBriefingFocus {
  kind: DashboardBriefingFocusKind;
  title: string;
  detail: string;
  action: DashboardAction;
}

export interface DashboardHomeModelInput {
  isRecording: boolean;
  meetings: Meeting[];
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  attentionAlerts?: AttentionItem[];
  workspace: KnowledgeWorkspacePayload | null;
  workingMemorySnapshot?: WorkingMemorySnapshot | null;
  workingMemorySnapshots?: WorkingMemorySnapshot[];
  graphStats: KnowledgeGraphStats | null;
}

export interface DashboardHomeModel {
  hero: DashboardHero;
  briefingFocus: DashboardBriefingFocus;
  latestMeeting: DashboardLatestMeeting;
  actionInsights: DashboardActionInsights;
  knowledgeDocuments: DashboardKnowledgeDocuments;
  spotlight: DashboardSpotlight | null;
  quickActions: DashboardAction[];
  graphStats: KnowledgeGraphStats | null;
}

interface MeetingAnalysisOverview {
  overview?: unknown;
}

interface KnowledgeDocCurrentRead {
  headline?: unknown;
  source_count?: unknown;
}

interface KnowledgeDocStructuredSummary {
  current_read?: KnowledgeDocCurrentRead;
}

const MAX_MEETING_DETAIL_LENGTH = 180;
const MAX_ACTION_INSIGHT_ITEMS = 5;

const sortByNewestTimestamp = <T>(
  items: T[],
  getTimestamp: (item: T) => string | null | undefined,
): T[] =>
  [...items].sort(
    (a, b) => toTimestamp(getTimestamp(b)) - toTimestamp(getTimestamp(a)),
  );

const toTimestamp = (value: string | null | undefined): number => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const clampText = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const parseJsonObject = <T>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
};

const titleCase = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const formatDueLabel = (value: string | null): string => {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Due date unknown';
  return `Due ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })}`;
};

const getMeetingTimestamp = (meeting: Meeting): string =>
  meeting.started_at || meeting.created_at;

const compareActionsByDueDate = (a: Entity, b: Entity): number => {
  const aDue = toTimestamp(a.due_date);
  const bDue = toTimestamp(b.due_date);

  if (aDue > 0 && bDue > 0 && aDue !== bDue) {
    return aDue - bDue;
  }
  if (aDue > 0) return -1;
  if (bDue > 0) return 1;

  return toTimestamp(a.updated_at) - toTimestamp(b.updated_at);
};

const compareActionsByOldestUpdate = (a: Entity, b: Entity): number =>
  toTimestamp(a.updated_at) - toTimestamp(b.updated_at);

const sortActions = (
  actions: Entity[],
  compare: (a: Entity, b: Entity) => number,
): Entity[] =>
  actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => compare(a.action, b.action) || a.index - b.index)
    .map(({ action }) => action);

const DASHBOARD_SUPPRESSED_ALERT_STATUSES = new Set([
  'dismissed',
  'snoozed',
] as const);
const DASHBOARD_ATTENTION_STATUS_ORDER: Record<
  AttentionItem['status'],
  number
> = {
  active: 0,
  snoozed: 1,
  dismissed: 2,
};

const shouldSuppressDashboardAction = (
  actionId: string,
  attentionAlerts: AttentionItem[],
): boolean => {
  const linkedAlerts = attentionAlerts.filter((item) =>
    item.related_entity_ids.includes(actionId),
  );

  return (
    linkedAlerts.length > 0 &&
    linkedAlerts.every((item) =>
      DASHBOARD_SUPPRESSED_ALERT_STATUSES.has(item.status),
    )
  );
};

const getDashboardActionAttentionContext = (
  linkedAttention: AttentionItem | null,
): Pick<DashboardActionInsightItem, 'attentionLabel' | 'attentionReason'> => {
  if (
    linkedAttention == null ||
    linkedAttention.status !== 'active' ||
    linkedAttention.kind !== 'blocker'
  ) {
    return {
      attentionLabel: null,
      attentionReason: null,
    };
  }

  const normalizedReason = linkedAttention.reason?.trim() || null;
  return {
    attentionLabel: 'Blocker',
    attentionReason: normalizedReason,
  };
};

const getDashboardHeroActionDetail = (
  action: Entity,
  attentionAlerts: AttentionItem[],
): string => {
  const linkedAttention = getLinkedDashboardAttention(
    action.id,
    attentionAlerts,
  );
  const blockerReason =
    linkedAttention?.status === 'active' && linkedAttention.kind === 'blocker'
      ? linkedAttention.reason?.trim() || null
      : null;
  return blockerReason || `${action.name} needs attention`;
};

const hasActiveLinkedBlocker = (
  actionId: string,
  attentionAlerts: AttentionItem[],
): boolean =>
  attentionAlerts.some(
    (item) =>
      item.status === 'active' &&
      item.kind === 'blocker' &&
      item.related_entity_ids.includes(actionId),
  );

const countActiveLinkedBlockers = (
  actions: Entity[],
  attentionAlerts: AttentionItem[],
): number =>
  actions.filter((action) => hasActiveLinkedBlocker(action.id, attentionAlerts))
    .length;

const getActiveLinkedBlockerReason = (
  actionId: string,
  attentionAlerts: AttentionItem[],
): string | null => {
  const reason = attentionAlerts.find(
    (item) =>
      item.status === 'active' &&
      item.kind === 'blocker' &&
      item.related_entity_ids.includes(actionId) &&
      item.reason?.trim(),
  )?.reason;

  return reason?.trim() || null;
};

const compareOverdueDashboardActions = (
  a: Entity,
  b: Entity,
  attentionAlerts: AttentionItem[],
): number => {
  const aBlocked = hasActiveLinkedBlocker(a.id, attentionAlerts);
  const bBlocked = hasActiveLinkedBlocker(b.id, attentionAlerts);
  if (aBlocked !== bBlocked) {
    return aBlocked ? -1 : 1;
  }
  return compareActionsByDueDate(a, b);
};

const compareActiveDashboardActions = (
  a: Entity,
  b: Entity,
  attentionAlerts: AttentionItem[],
): number => {
  const aBlocked = hasActiveLinkedBlocker(a.id, attentionAlerts);
  const bBlocked = hasActiveLinkedBlocker(b.id, attentionAlerts);
  if (aBlocked !== bBlocked) {
    return aBlocked ? -1 : 1;
  }
  return compareActionsByDueDate(a, b);
};

const compareStaleDashboardActions = (
  a: Entity,
  b: Entity,
  attentionAlerts: AttentionItem[],
): number => {
  const aBlocked = hasActiveLinkedBlocker(a.id, attentionAlerts);
  const bBlocked = hasActiveLinkedBlocker(b.id, attentionAlerts);
  if (aBlocked !== bBlocked) {
    return aBlocked ? -1 : 1;
  }
  return compareActionsByOldestUpdate(a, b);
};

const filterSuppressedDashboardActions = (
  actions: Entity[],
  attentionAlerts: AttentionItem[],
): Entity[] =>
  actions.filter(
    (action) => !shouldSuppressDashboardAction(action.id, attentionAlerts),
  );

const compareDashboardAttentionPriority = (
  left: AttentionItem,
  right: AttentionItem,
): number => {
  const leftStatusRank = DASHBOARD_ATTENTION_STATUS_ORDER[left.status];
  const rightStatusRank = DASHBOARD_ATTENTION_STATUS_ORDER[right.status];
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const leftIsActiveBlocker =
    left.status === 'active' && left.kind === 'blocker';
  const rightIsActiveBlocker =
    right.status === 'active' && right.kind === 'blocker';
  if (leftIsActiveBlocker !== rightIsActiveBlocker) {
    return leftIsActiveBlocker ? -1 : 1;
  }

  if (leftIsActiveBlocker && rightIsActiveBlocker) {
    const reasonLengthDifference =
      (right.reason?.trim().length ?? 0) - (left.reason?.trim().length ?? 0);
    if (reasonLengthDifference !== 0) return reasonLengthDifference;
  }

  return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
};

const getLinkedDashboardAttention = (
  actionId: string,
  attentionAlerts: AttentionItem[],
): AttentionItem | null => {
  const linkedAlerts = attentionAlerts.filter((item) =>
    item.related_entity_ids.includes(actionId),
  );
  if (linkedAlerts.length === 0) {
    return null;
  }

  return [...linkedAlerts].sort(compareDashboardAttentionPriority)[0] ?? null;
};

const getHeroLabel = (
  kind: DashboardHeroKind,
  options: { hasLinkedBlocker?: boolean } = {},
): string => {
  if (options.hasLinkedBlocker) return 'Blocked';

  switch (kind) {
    case 'recording':
      return 'Live capture';
    case 'overdue_action':
    case 'active_action':
      return 'Needs attention';
    case 'stale_action':
      return 'Watch';
    case 'latest_meeting':
      return 'Latest meeting';
    case 'knowledge_doc':
      return 'Recent memory';
    case 'default':
      return 'Ready';
  }
};

const getMeetingDetail = (meeting: Meeting): string => {
  const analysis = parseJsonObject<MeetingAnalysisOverview>(
    meeting.analysis_json,
  );
  if (typeof analysis?.overview === 'string' && analysis.overview.trim()) {
    return analysis.overview.trim();
  }
  const firstEnhancedNotesLine = meeting.enhanced_notes
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (firstEnhancedNotesLine) {
    return clampText(firstEnhancedNotesLine, MAX_MEETING_DETAIL_LENGTH);
  }
  return 'Open the latest meeting notes and extracted context.';
};

const buildLatestMeeting = (meetings: Meeting[]): DashboardLatestMeeting => {
  const latest = sortByNewestTimestamp(meetings, getMeetingTimestamp)[0];
  if (!latest) {
    return {
      state: 'empty',
      title: 'No meetings yet',
      detail: 'Record a conversation to start building meeting memory.',
    };
  }

  return {
    state: 'populated',
    meetingId: latest.id,
    title: latest.title,
    detail: getMeetingDetail(latest),
    occurredAt: getMeetingTimestamp(latest),
  };
};

const actionToInsightItem = (
  action: Entity,
  status: DashboardActionInsightItem['status'],
  contextLabel: string | null,
  linkedAttention: AttentionItem | null,
): DashboardActionInsightItem => ({
  id: action.id,
  title: action.name,
  dueLabel: formatDueLabel(action.due_date),
  status,
  sourceLabel: titleCase(action.domain_tag || 'workspace'),
  contextLabel,
  ...getDashboardActionAttentionContext(linkedAttention),
  attentionItemId: linkedAttention?.id ?? null,
  attentionStatus: linkedAttention?.status ?? null,
  dismissLabel:
    linkedAttention == null
      ? null
      : linkedAttention.status === 'dismissed'
        ? 'Reopen'
        : linkedAttention.status === 'snoozed'
          ? null
          : linkedAttention.kind === 'blocker'
            ? 'Dismiss blocker'
            : 'Dismiss',
  snoozeLabel:
    linkedAttention == null
      ? null
      : linkedAttention.status === 'dismissed'
        ? null
        : linkedAttention.status === 'snoozed'
          ? 'Reopen'
          : linkedAttention.kind === 'blocker'
            ? 'Snooze blocker'
            : 'Snooze',
});

const getDashboardActionContextLabel = (
  linkedAttention: AttentionItem | null,
  actionId: string,
  attentionAlerts: AttentionItem[],
  meetings: Meeting[],
): string | null => {
  const blockerReason =
    getDashboardActionAttentionContext(linkedAttention).attentionReason;
  if (blockerReason) {
    return blockerReason;
  }

  const relatedMeetingIds = Array.from(
    new Set(
      attentionAlerts
        .filter(
          (item) =>
            item.status === 'active' &&
            item.related_entity_ids.includes(actionId),
        )
        .flatMap((item) => item.related_meeting_ids),
    ),
  );

  if (relatedMeetingIds.length === 0) {
    return null;
  }

  const meetingsById = new Map(
    meetings.map((meeting) => [meeting.id, meeting]),
  );
  const latestRelatedMeeting = sortByNewestTimestamp(
    relatedMeetingIds
      .map((meetingId) => meetingsById.get(meetingId))
      .filter((meeting): meeting is Meeting => Boolean(meeting)),
    getMeetingTimestamp,
  )[0];
  const title = latestRelatedMeeting?.title?.trim();

  return title || null;
};

const buildActionInsights = (
  meetings: Meeting[],
  overdueActions: Entity[],
  staleActions: Entity[],
  activeActions: Entity[],
  attentionAlerts: AttentionItem[],
): DashboardActionInsights => {
  const prioritizedItems = [
    ...sortActions(overdueActions, (a, b) =>
      compareOverdueDashboardActions(a, b, attentionAlerts),
    ).map((action) => {
      const linkedAttention = getLinkedDashboardAttention(
        action.id,
        attentionAlerts,
      );
      const contextLabel = getDashboardActionContextLabel(
        linkedAttention,
        action.id,
        attentionAlerts,
        meetings,
      );
      return actionToInsightItem(
        action,
        'overdue',
        contextLabel,
        linkedAttention,
      );
    }),
    ...sortActions(staleActions, (a, b) =>
      compareStaleDashboardActions(a, b, attentionAlerts),
    ).map((action) => {
      const linkedAttention = getLinkedDashboardAttention(
        action.id,
        attentionAlerts,
      );
      const contextLabel = getDashboardActionContextLabel(
        linkedAttention,
        action.id,
        attentionAlerts,
        meetings,
      );
      return actionToInsightItem(
        action,
        'stale',
        contextLabel,
        linkedAttention,
      );
    }),
    ...sortActions(activeActions, (a, b) => {
      const aBlocked = hasActiveLinkedBlocker(a.id, attentionAlerts);
      const bBlocked = hasActiveLinkedBlocker(b.id, attentionAlerts);
      if (aBlocked !== bBlocked) {
        return aBlocked ? -1 : 1;
      }
      return compareActionsByDueDate(a, b);
    }).map((action) => {
      const linkedAttention = getLinkedDashboardAttention(
        action.id,
        attentionAlerts,
      );
      const contextLabel = getDashboardActionContextLabel(
        linkedAttention,
        action.id,
        attentionAlerts,
        meetings,
      );
      return actionToInsightItem(
        action,
        'active',
        contextLabel,
        linkedAttention,
      );
    }),
  ];
  const seenIds = new Set<string>();
  const items = prioritizedItems
    .filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .slice(0, MAX_ACTION_INSIGHT_ITEMS);

  if (items.length === 0) {
    return {
      state: 'empty',
      overdueCount: 0,
      staleCount: 0,
      activeCount: 0,
      items: [],
    };
  }

  return {
    state: 'populated',
    overdueCount: overdueActions.length,
    staleCount: staleActions.length,
    activeCount: activeActions.length,
    items,
  };
};

const getKnowledgeDocHeadline = (doc: KnowledgeDoc): string => {
  const structured = parseJsonObject<KnowledgeDocStructuredSummary>(
    doc.structured_json,
  );
  const headline = structured?.current_read?.headline;
  if (typeof headline === 'string' && headline.trim()) {
    return headline.trim();
  }

  const renderedHeadline = doc.rendered_content
    ?.split('\n')
    .map((line) => line.trim().replace(/^#+\s+/, ''))
    .find(Boolean);

  return renderedHeadline || 'No synthesized read yet.';
};

const getKnowledgeDocSourceCount = (doc: KnowledgeDoc): number | null => {
  const structured = parseJsonObject<KnowledgeDocStructuredSummary>(
    doc.structured_json,
  );
  const sourceCount = structured?.current_read?.source_count;
  return typeof sourceCount === 'number' ? sourceCount : null;
};

const formatCountLabel = (count: number | null): string =>
  count === null ? 'No sources yet' : pluralize(count, 'source');

const formatProjectHealthCountLabel = (
  card: KnowledgeProjectHealthCard,
): string =>
  `${pluralize(card.open_blockers, 'blocker')} · ${pluralize(
    card.dependency_count,
    'dependency',
    'dependencies',
  )}`;

const hasProjectHealthSignal = (
  card: KnowledgeProjectHealthCard | undefined,
): boolean =>
  Boolean(
    card &&
      (card.open_blockers > 0 ||
        card.dependency_count > 0 ||
        card.recent_changes > 0 ||
        card.staleness_days > 0),
  );

const isUsableKnowledgeDoc = (
  doc: KnowledgeDoc,
  projectCard: KnowledgeProjectHealthCard | undefined,
): boolean => {
  if (hasProjectHealthSignal(projectCard)) return true;
  const sourceCount = getKnowledgeDocSourceCount(doc);
  if (sourceCount !== null) return sourceCount > 0;
  return doc.status !== 'inactive' && Boolean(getKnowledgeDocHeadline(doc));
};

const matchesWorkingMemorySnapshot = (
  doc: KnowledgeDoc,
  workingMemorySnapshot: WorkingMemorySnapshot | null | undefined,
): workingMemorySnapshot is WorkingMemorySnapshot =>
  matchesWorkingMemorySnapshotToDoc(doc, workingMemorySnapshot);

const buildWorkingMemorySnapshotMap = (
  snapshots: WorkingMemorySnapshot[] | null | undefined,
): Map<string, WorkingMemorySnapshot> =>
  new Map(
    (snapshots ?? []).map((snapshot) => [
      `${snapshot.scope_type}:${snapshot.scope_key}`,
      snapshot,
    ]),
  );

const getKnowledgeDocCardDetail = (
  doc: KnowledgeDoc,
  workingMemorySnapshot: WorkingMemorySnapshot | null | undefined,
): {
  description: string;
  sourceCount: number | null;
  trustStatus: TrustStatus | null;
  trustDescription: string | null;
} => {
  if (matchesWorkingMemorySnapshot(doc, workingMemorySnapshot)) {
    const brief = compileKnowledgeBrief(doc, workingMemorySnapshot);
    return {
      description: brief.headline,
      sourceCount: workingMemorySnapshot.source_count,
      trustStatus: brief.trustStatus,
      trustDescription: brief.trustDescription,
    };
  }

  const v2 = parseStructuredKnowledgeV2Doc(doc);
  const trustStatus = (() => {
    if (!v2) return null;
    return deriveKnowledgeTrustStatus({
      docStatus: doc.status,
      evidenceQuality: v2.current_read.evidence_quality,
    });
  })();

  return {
    description: getKnowledgeDocHeadline(doc),
    sourceCount: getKnowledgeDocSourceCount(doc),
    trustStatus,
    trustDescription: trustStatus
      ? getTrustStatusMeta(trustStatus).description
      : null,
  };
};

const buildKnowledgeDocuments = (
  workspace: KnowledgeWorkspacePayload | null,
  workingMemorySnapshots: WorkingMemorySnapshot[] | null | undefined,
): DashboardKnowledgeDocuments => {
  const docs = workspace?.docs ?? [];
  if (docs.length === 0) {
    return {
      state: 'empty',
      cards: [],
    };
  }

  const projectCardsByDocId = new Map(
    (workspace?.project_cards ?? []).map((card) => [card.doc_id, card]),
  );
  const snapshotsByScope = buildWorkingMemorySnapshotMap(
    workingMemorySnapshots,
  );
  const usableDocs = docs.filter((doc) =>
    isUsableKnowledgeDoc(doc, projectCardsByDocId.get(doc.id)),
  );
  if (usableDocs.length === 0) {
    return {
      state: 'empty',
      cards: [],
    };
  }

  const cards = sortByNewestTimestamp(usableDocs, (doc) => doc.updated_at)
    .slice(0, 4)
    .map((doc) => {
      const projectCard = projectCardsByDocId.get(doc.id);
      const detail = getKnowledgeDocCardDetail(
        doc,
        snapshotsByScope.get(`${doc.scope_type}:${doc.scope_key}`),
      );
      return {
        id: doc.id,
        title: doc.title,
        description: detail.description,
        countLabel: projectCard
          ? formatProjectHealthCountLabel(projectCard)
          : formatCountLabel(detail.sourceCount),
        sourceCountLabel: formatCountLabel(detail.sourceCount),
        status: doc.status,
        scopeType: doc.scope_type,
        trustStatus: detail.trustStatus,
        trustDescription: detail.trustDescription,
      };
    });

  return {
    state: 'populated',
    cards,
  };
};

const getProjectPriorityScore = (card: KnowledgeProjectHealthCard): number =>
  card.open_blockers * 100 +
  card.dependency_count * 10 +
  card.staleness_days +
  card.recent_changes;

const hasProjectSignal = (card: KnowledgeProjectHealthCard): boolean =>
  hasProjectHealthSignal(card);

const buildSpotlight = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardSpotlight | null => {
  const card = [...(workspace?.project_cards ?? [])]
    .filter(hasProjectSignal)
    .sort((a, b) => getProjectPriorityScore(b) - getProjectPriorityScore(a))[0];
  if (!card) return null;

  const tags = [
    card.open_blockers > 0 ? pluralize(card.open_blockers, 'blocker') : '',
    card.dependency_count > 0
      ? pluralize(card.dependency_count, 'dependency', 'dependencies')
      : '',
    card.recent_changes > 0
      ? pluralize(card.recent_changes, 'recent change')
      : '',
    card.staleness_days > 0 ? `${card.staleness_days}d stale` : '',
  ].filter(Boolean);

  return {
    title: card.title,
    subtitle: card.open_blockers > 0 ? 'Blocked project' : 'Project spotlight',
    badgeLabel: card.open_blockers > 0 ? 'Blocked' : 'Projects',
    detail: tags.length > 0 ? tags.join(' | ') : 'No blockers surfaced',
    tags,
    hasBlockers: card.open_blockers > 0,
    target: 'projects',
  };
};

const buildHero = (
  input: DashboardHomeModelInput,
  latestMeeting: DashboardLatestMeeting,
  knowledgeDocuments: DashboardKnowledgeDocuments,
): DashboardHero => {
  if (input.isRecording) {
    return {
      kind: 'recording',
      label: getHeroLabel('recording'),
      title: 'Recording in progress',
      detail: 'Pluto is listening and will synthesize this conversation next.',
      severity: 'live',
      action: { label: 'Ask Pluto', target: 'ask' },
    };
  }

  const overdueAction = sortActions(input.overdueActions, (a, b) =>
    compareOverdueDashboardActions(a, b, input.attentionAlerts ?? []),
  )[0];
  if (overdueAction) {
    const hasLinkedBlocker = hasActiveLinkedBlocker(
      overdueAction.id,
      input.attentionAlerts ?? [],
    );
    const blockedOverdueCount = hasLinkedBlocker
      ? countActiveLinkedBlockers(
          input.overdueActions,
          input.attentionAlerts ?? [],
        )
      : 0;
    return {
      kind: 'overdue_action',
      label: getHeroLabel('overdue_action', { hasLinkedBlocker }),
      title: hasLinkedBlocker
        ? pluralize(blockedOverdueCount, 'blocked item')
        : pluralize(input.overdueActions.length, 'overdue item'),
      detail: joinCountLabels([
        getDashboardHeroActionDetail(
          overdueAction,
          input.attentionAlerts ?? [],
        ),
        input.staleActions.length > 0
          ? pluralize(input.staleActions.length, 'stale item')
          : '',
      ]),
      severity: 'urgent',
      action: {
        label: hasLinkedBlocker ? 'Review blockers' : 'Open projects',
        target: 'projects',
      },
    };
  }

  const staleAction = sortActions(input.staleActions, (a, b) =>
    compareStaleDashboardActions(a, b, input.attentionAlerts ?? []),
  )[0];
  if (staleAction) {
    const hasLinkedBlocker = hasActiveLinkedBlocker(
      staleAction.id,
      input.attentionAlerts ?? [],
    );
    const blockedStaleCount = hasLinkedBlocker
      ? countActiveLinkedBlockers(
          input.staleActions,
          input.attentionAlerts ?? [],
        )
      : 0;
    const blockerReason = hasLinkedBlocker
      ? getActiveLinkedBlockerReason(
          staleAction.id,
          input.attentionAlerts ?? [],
        )
      : null;
    return {
      kind: 'stale_action',
      label: getHeroLabel('stale_action', { hasLinkedBlocker }),
      title: hasLinkedBlocker
        ? pluralize(blockedStaleCount, 'blocked item')
        : pluralize(input.staleActions.length, 'stale item'),
      detail: blockerReason ?? `${staleAction.name} has gone quiet.`,
      severity: 'watch',
      action: {
        label: hasLinkedBlocker ? 'Review blockers' : 'Open projects',
        target: 'projects',
      },
    };
  }

  const prioritizedActiveAction = sortActions(input.activeActions, (a, b) =>
    compareActiveDashboardActions(a, b, input.attentionAlerts ?? []),
  )[0];
  if (
    prioritizedActiveAction &&
    hasActiveLinkedBlocker(
      prioritizedActiveAction.id,
      input.attentionAlerts ?? [],
    )
  ) {
    const blockedActiveCount = countActiveLinkedBlockers(
      input.activeActions,
      input.attentionAlerts ?? [],
    );
    return {
      kind: 'active_action',
      label: getHeroLabel('active_action', { hasLinkedBlocker: true }),
      title: pluralize(blockedActiveCount, 'blocked item'),
      detail: getDashboardHeroActionDetail(
        prioritizedActiveAction,
        input.attentionAlerts ?? [],
      ),
      severity: 'urgent',
      action: { label: 'Review blockers', target: 'projects' },
    };
  }

  if (prioritizedActiveAction) {
    return {
      kind: 'active_action',
      label: getHeroLabel('active_action'),
      title: pluralize(input.activeActions.length, 'active follow-up'),
      detail: `${prioritizedActiveAction.name} needs attention`,
      severity: 'watch',
      action: { label: 'Open projects', target: 'projects' },
    };
  }

  if (latestMeeting.state === 'populated') {
    return {
      kind: 'latest_meeting',
      label: getHeroLabel('latest_meeting'),
      title: latestMeeting.title,
      detail: latestMeeting.detail,
      severity: 'calm',
      action: {
        label: 'Review latest',
        target: 'meeting',
        meetingId: latestMeeting.meetingId,
      },
    };
  }

  const doc = knowledgeDocuments.cards[0];
  if (doc) {
    return {
      kind: 'knowledge_doc',
      label: getHeroLabel('knowledge_doc'),
      title: doc.title,
      detail: doc.description,
      severity: 'calm',
      action: { label: 'Knowledge home', target: 'wiki' },
    };
  }

  return {
    kind: 'default',
    label: getHeroLabel('default'),
    title: 'Start with a conversation',
    detail:
      'Record a meeting to build memory, or ask Pluto to help recover context from what is already here.',
    severity: 'calm',
    action: { label: 'Start with Ask Pluto', target: 'ask' },
  };
};

const buildQuickActions = (
  latestMeeting: DashboardLatestMeeting,
  actionInsights: DashboardActionInsights,
  knowledgeDocuments: DashboardKnowledgeDocuments,
  spotlight: DashboardSpotlight | null,
): DashboardAction[] => {
  const actions: DashboardAction[] = [
    {
      label:
        latestMeeting.state === 'empty' &&
        actionInsights.state === 'empty' &&
        knowledgeDocuments.state === 'empty' &&
        !spotlight
          ? 'Start with Ask Pluto'
          : 'Ask Pluto',
      target: 'ask',
    },
  ];

  if (latestMeeting.state === 'populated') {
    actions.push({
      label: 'Review latest',
      target: 'meeting',
      meetingId: latestMeeting.meetingId,
    });
  }

  if (actionInsights.state === 'populated' || spotlight) {
    actions.push({
      label:
        actionInsights.state === 'empty' && spotlight?.hasBlockers
          ? 'Review blockers'
          : 'Open projects',
      target: 'projects',
    });
  }

  if (knowledgeDocuments.state === 'populated') {
    actions.push({ label: 'Knowledge home', target: 'wiki' });
  }

  return actions;
};

const joinCountLabels = (labels: string[]): string =>
  labels.filter(Boolean).join(' · ');

const buildBriefingFocus = (
  hero: DashboardHero,
  actionInsights: DashboardActionInsights,
  latestMeeting: DashboardLatestMeeting,
  knowledgeDocuments: DashboardKnowledgeDocuments,
  activeActions: Entity[],
  staleActions: Entity[],
  attentionAlerts: AttentionItem[],
): DashboardBriefingFocus => {
  if (actionInsights.state === 'populated' && actionInsights.overdueCount > 0) {
    return {
      kind: 'attention',
      title: 'Needs attention',
      detail: joinCountLabels([
        actionInsights.overdueCount > 0
          ? pluralize(actionInsights.overdueCount, 'overdue item')
          : '',
        actionInsights.staleCount > 0
          ? pluralize(actionInsights.staleCount, 'stale item')
          : '',
      ]),
      action: { label: 'Review actions', target: 'projects' },
    };
  }

  const prioritizedStaleAction = sortActions(staleActions, (a, b) =>
    compareStaleDashboardActions(a, b, attentionAlerts),
  )[0];
  if (
    actionInsights.state === 'populated' &&
    prioritizedStaleAction &&
    hasActiveLinkedBlocker(prioritizedStaleAction.id, attentionAlerts)
  ) {
    const blockedStaleCount = staleActions.filter((action) =>
      hasActiveLinkedBlocker(action.id, attentionAlerts),
    ).length;
    const blockerReason = getActiveLinkedBlockerReason(
      prioritizedStaleAction.id,
      attentionAlerts,
    );
    return {
      kind: 'attention',
      title:
        blockedStaleCount === 1 ? 'Blocked follow-up' : 'Blocked follow-ups',
      detail: blockerReason ?? pluralize(blockedStaleCount, 'blocked item'),
      action: { label: 'Review blockers', target: 'projects' },
    };
  }

  if (actionInsights.state === 'populated' && actionInsights.staleCount > 0) {
    return {
      kind: 'attention',
      title: 'Needs attention',
      detail: pluralize(actionInsights.staleCount, 'stale item'),
      action: { label: 'Review actions', target: 'projects' },
    };
  }

  const prioritizedActiveAction = sortActions(activeActions, (a, b) =>
    compareActiveDashboardActions(a, b, attentionAlerts),
  )[0];
  if (
    prioritizedActiveAction &&
    hasActiveLinkedBlocker(prioritizedActiveAction.id, attentionAlerts)
  ) {
    const blockedActiveCount = activeActions.filter((action) =>
      hasActiveLinkedBlocker(action.id, attentionAlerts),
    ).length;
    const blockerReason = getActiveLinkedBlockerReason(
      prioritizedActiveAction.id,
      attentionAlerts,
    );
    return {
      kind: 'attention',
      title:
        blockedActiveCount === 1 ? 'Blocked follow-up' : 'Blocked follow-ups',
      detail: blockerReason ?? pluralize(blockedActiveCount, 'blocked item'),
      action: { label: 'Review blockers', target: 'projects' },
    };
  }

  if (
    actionInsights.state === 'populated' &&
    actionInsights.activeCount > 0 &&
    hero.kind === 'active_action' &&
    hero.severity === 'watch'
  ) {
    return {
      kind: 'attention',
      title: 'Needs attention',
      detail: pluralize(actionInsights.activeCount, 'active item'),
      action: { label: 'Review actions', target: 'projects' },
    };
  }

  if (latestMeeting.state === 'populated') {
    return {
      kind: 'latest_meeting',
      title: 'Latest meeting',
      detail: latestMeeting.detail,
      action: {
        label: 'Open brief',
        target: 'meeting',
        meetingId: latestMeeting.meetingId,
      },
    };
  }

  const doc = knowledgeDocuments.cards[0];
  if (doc) {
    return {
      kind: 'knowledge_doc',
      title: 'Recent memory',
      detail: doc.description,
      action: { label: 'Open knowledge', target: 'wiki' },
    };
  }

  return {
    kind: 'empty',
    title: 'Build your first briefing',
    detail:
      'Record a conversation and Pluto will turn it into memory, follow-ups, and cited context.',
    action: { label: 'Ask Pluto', target: 'ask' },
  };
};

export const buildDashboardHomeModel = (
  input: DashboardHomeModelInput,
): DashboardHomeModel => {
  const workingMemorySnapshots =
    input.workingMemorySnapshots ??
    (input.workingMemorySnapshot ? [input.workingMemorySnapshot] : []);
  const attentionAlerts = input.attentionAlerts ?? [];
  const overdueActions = filterSuppressedDashboardActions(
    input.overdueActions,
    attentionAlerts,
  );
  const staleActions = filterSuppressedDashboardActions(
    input.staleActions,
    attentionAlerts,
  );
  const activeActions = filterSuppressedDashboardActions(
    input.activeActions,
    attentionAlerts,
  );
  const latestMeeting = buildLatestMeeting(input.meetings);
  const actionInsights = buildActionInsights(
    input.meetings,
    overdueActions,
    staleActions,
    activeActions,
    attentionAlerts,
  );
  const knowledgeDocuments = buildKnowledgeDocuments(
    input.workspace,
    workingMemorySnapshots,
  );
  const spotlight = buildSpotlight(input.workspace);
  const hero = buildHero(
    {
      ...input,
      overdueActions,
      staleActions,
      activeActions,
    },
    latestMeeting,
    knowledgeDocuments,
  );

  return {
    hero,
    briefingFocus: buildBriefingFocus(
      hero,
      actionInsights,
      latestMeeting,
      knowledgeDocuments,
      activeActions,
      staleActions,
      attentionAlerts,
    ),
    latestMeeting,
    actionInsights,
    knowledgeDocuments,
    spotlight,
    quickActions: buildQuickActions(
      latestMeeting,
      actionInsights,
      knowledgeDocuments,
      spotlight,
    ),
    graphStats: input.graphStats,
  };
};
