import type { WorkingMemorySnapshot } from '../../../electron/db';
import type { AttentionItem } from '../../../electron/intelligence/intelligenceTypes';
import type { KnowledgeDoc } from '../../api/knowledgeDocs';
import type { Entity, KnowledgeGraphStats } from '../../api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../api/knowledgeWorkspace';
import type { Meeting } from '../../types';
import {
  type ThirdPartyAssigneeOptions,
  canonicalizeActionText,
  getCommitmentState,
  isThirdPartyAction,
  parseActionMetadata,
} from '../../utils/actionCommitment';
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
  assigneeName?: string | null;
  assignedTo?: string | null;
  dueLabel: string;
  status: 'overdue' | 'stale' | 'active';
  commitmentState: 'possible' | 'confirmed';
  reviewedAt: string | null;
  statusLabel: string;
  basisLabel: string;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  sourceSynthesis: DashboardCommitmentSourceSynthesis | null;
  canComplete: boolean;
  sourceLabel: string;
  contextLabel: string | null;
  attentionLabel: string | null;
  attentionReason: string | null;
  attentionItemId: string | null;
  attentionStatus: AttentionItem['status'] | null;
  dismissLabel: 'Dismiss' | 'Dismiss blocker' | 'Reopen' | null;
  snoozeLabel: 'Snooze' | 'Snooze blocker' | 'Reopen' | null;
  dailyPriorityRank: number | null;
}

export interface DashboardCommitmentSourceSynthesis {
  overview: string | null;
  topicTitle: string | null;
  topicSummary: string | null;
  evidence: string | null;
}

export interface DashboardTopOfMindItem {
  id: string;
  read: string;
  whyNow: string;
  consequence: string | null;
  suggestedMove: string;
  evidenceLabel: string;
  action: DashboardAction;
  trustState: 'directly supported' | 'inferred' | 'weak' | 'stale';
}

export type DashboardTopOfMind =
  | {
      state: 'empty';
      summary: string;
      items: [];
    }
  | {
      state: 'populated';
      summary: string;
      items: DashboardTopOfMindItem[];
    };

export type DashboardActionInsights =
  | {
      state: 'empty';
      overdueCount: 0;
      staleCount: 0;
      activeCount: 0;
      possibleCount: 0;
      confirmedCount: 0;
      summary: string;
      items: [];
      allItems: [];
    }
  | {
      state: 'populated';
      overdueCount: number;
      staleCount: number;
      activeCount: number;
      possibleCount: number;
      confirmedCount: number;
      summary: string;
      items: DashboardActionInsightItem[];
      allItems: DashboardActionInsightItem[];
    };

export type DashboardCommitments =
  | {
      state: 'empty';
      summary: string;
      items: [];
      backlog: DashboardActionInsightItem[];
    }
  | {
      state: 'populated';
      summary: string;
      items: DashboardActionInsightItem[];
      backlog: DashboardActionInsightItem[];
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

export type DashboardWeeklyWinItem =
  | {
      id: string;
      kind: 'evidence';
      title: string;
      whyItCounts: string;
      sourceLabel: string;
      dateLabel: string;
      timestamp: number;
      meetingId: Meeting['id'];
    }
  | {
      id: string;
      kind: 'milestone';
      title: string;
      whyItCounts: string;
      sourceLabel: string;
      dateLabel: string;
      timestamp: number;
      meetingId: Meeting['id'];
    };

export type DashboardWeeklyWins =
  | {
      state: 'empty';
      title: string;
      detail: string;
    }
  | {
      state: 'populated';
      items: DashboardWeeklyWinItem[];
      total: number;
    };

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
  dateKey?: string;
  meetings: Meeting[];
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  attentionAlerts?: AttentionItem[];
  workspace: KnowledgeWorkspacePayload | null;
  workingMemorySnapshot?: WorkingMemorySnapshot | null;
  workingMemorySnapshots?: WorkingMemorySnapshot[];
  graphStats: KnowledgeGraphStats | null;
  selfPersonId?: string | null;
  selfNames?: string[];
}

export interface DashboardHomeModel {
  hero: DashboardHero;
  topOfMind: DashboardTopOfMind;
  commitments: DashboardCommitments;
  recentWin: DashboardWeeklyWins;
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

interface MeetingAnalysisActionItem {
  text?: unknown;
  topic?: unknown;
  evidence?: unknown;
}

interface MeetingAnalysisTopic {
  title?: unknown;
  summary?: unknown;
  action_items?: unknown;
}

interface MeetingAnalysisSource {
  overview?: unknown;
  summary?: unknown;
  topics?: unknown;
  all_action_items?: unknown;
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
const MAX_DASHBOARD_BRIEFING_ITEMS = 3;

export const getDashboardDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDailyPriorityRank = (
  metadata: Record<string, unknown>,
  dateKey: string,
): number | null => {
  const priority = metadata.dashboard_daily_priority;
  if (!priority || typeof priority !== 'object' || Array.isArray(priority)) {
    return null;
  }
  const { date, rank } = priority as Record<string, unknown>;
  return date === dateKey && Number.isInteger(rank) && Number(rank) >= 0
    ? Number(rank)
    : null;
};

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

const formatMeetingBasisDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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

const DASHBOARD_SUPPRESSED_ALERT_STATUSES = new Set<AttentionItem['status']>([
  'dismissed',
  'snoozed',
] as const);
const DASHBOARD_ATTENTION_STATUS_ORDER: Record<
  AttentionItem['status'],
  number
> = {
  active: 0,
  pinned: 1,
  stale: 2,
  snoozed: 3,
  resolved: 4,
  dismissed: 5,
  superseded: 6,
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

const filterRejectedDashboardActions = (actions: Entity[]): Entity[] =>
  actions.filter(
    (action) => getCommitmentState(action.metadata) !== 'rejected',
  );

const filterConfirmedDashboardActions = (actions: Entity[]): Entity[] =>
  actions.filter(
    (action) => getCommitmentState(action.metadata) === 'confirmed',
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
  if (meeting.dashboard_detail?.trim()) {
    return meeting.dashboard_detail.trim();
  }
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

const getTrimmedString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeActionText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const actionTextMatches = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeActionText(left);
  const normalizedRight = normalizeActionText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const [shorter, longer] =
    normalizedLeft.length < normalizedRight.length
      ? [normalizedLeft, normalizedRight]
      : [normalizedRight, normalizedLeft];
  return shorter.length >= 40 && longer.startsWith(shorter);
};

const getLegacyAnalysisSummary = (value: unknown): string | null => {
  if (typeof value === 'string') return getTrimmedString(value);
  if (!Array.isArray(value)) return null;
  const paragraphs = value
    .map(getTrimmedString)
    .filter((paragraph): paragraph is string => Boolean(paragraph));
  return paragraphs.length ? paragraphs.join(' ') : null;
};

const getAnalysisActionItems = (value: unknown): MeetingAnalysisActionItem[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is MeetingAnalysisActionItem =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

const getAnalysisTopics = (value: unknown): MeetingAnalysisTopic[] =>
  Array.isArray(value)
    ? value.filter(
        (topic): topic is MeetingAnalysisTopic =>
          Boolean(topic) && typeof topic === 'object' && !Array.isArray(topic),
      )
    : [];

const buildCommitmentSourceSynthesis = (
  action: Entity,
  sourceMeeting: Meeting | null,
): DashboardCommitmentSourceSynthesis | null => {
  if (!sourceMeeting) return null;
  const analysis = parseJsonObject<MeetingAnalysisSource>(
    sourceMeeting.analysis_json,
  );
  if (!analysis) {
    const overview = getTrimmedString(sourceMeeting.dashboard_detail);
    return overview
      ? { overview, topicTitle: null, topicSummary: null, evidence: null }
      : null;
  }

  const overview =
    getTrimmedString(analysis.overview) ??
    getLegacyAnalysisSummary(analysis.summary);
  const metadata = parseActionMetadata(action.metadata);
  const fullDescription = getTrimmedString(metadata.full_description);
  const originalDescription = getTrimmedString(metadata.original_description);
  const actionTexts = [
    fullDescription,
    originalDescription,
    getTrimmedString(action.name),
  ].filter((value): value is string => Boolean(value));
  const matchesAction = (candidate: MeetingAnalysisActionItem): boolean => {
    const candidateText = getTrimmedString(candidate.text);
    return Boolean(
      candidateText &&
        actionTexts.some((actionText) =>
          actionTextMatches(candidateText, actionText),
        ),
    );
  };

  const topics = getAnalysisTopics(analysis.topics);
  const rollupMatch = getAnalysisActionItems(analysis.all_action_items).find(
    matchesAction,
  );
  const rollupTopicTitle = getTrimmedString(rollupMatch?.topic);
  let matchedTopic = rollupTopicTitle
    ? topics.find((topic) => getTrimmedString(topic.title) === rollupTopicTitle)
    : undefined;
  let topicActionMatch: MeetingAnalysisActionItem | undefined;

  for (const topic of topics) {
    const match = getAnalysisActionItems(topic.action_items).find(
      matchesAction,
    );
    if (!match) continue;
    matchedTopic ??= topic;
    if (matchedTopic === topic) topicActionMatch = match;
    break;
  }

  const topicTitle = getTrimmedString(matchedTopic?.title) ?? rollupTopicTitle;
  const topicSummary = getTrimmedString(matchedTopic?.summary);
  const evidence =
    getTrimmedString(rollupMatch?.evidence) ??
    getTrimmedString(topicActionMatch?.evidence);

  return overview || topicTitle || topicSummary || evidence
    ? { overview, topicTitle, topicSummary, evidence }
    : null;
};

const actionToInsightItem = (
  action: Entity,
  status: DashboardActionInsightItem['status'],
  contextLabel: string | null,
  linkedAttention: AttentionItem | null,
  sourceMeeting: Meeting | null,
  dateKey: string,
): DashboardActionInsightItem => {
  const metadata = parseActionMetadata(action.metadata);
  const commitmentState =
    getCommitmentState(action.metadata) === 'confirmed'
      ? 'confirmed'
      : 'possible';
  const assigneeName =
    typeof metadata.assignee_name === 'string' ? metadata.assignee_name : null;
  const title =
    canonicalizeActionText(action.name, assigneeName ?? undefined) ||
    action.name;
  const attentionContext = getDashboardActionAttentionContext(linkedAttention);
  const dueLabel = formatDueLabel(action.due_date);
  const sourceLabel = titleCase(action.domain_tag || 'workspace');
  const sourceMeetingId = sourceMeeting ? String(sourceMeeting.id) : null;

  return {
    id: action.id,
    title,
    assigneeName,
    assignedTo: action.assigned_to ?? null,
    dueLabel,
    status,
    commitmentState,
    reviewedAt:
      typeof metadata.reviewed_at === 'string' ? metadata.reviewed_at : null,
    statusLabel:
      commitmentState === 'possible'
        ? 'Needs review'
        : (attentionContext.attentionLabel ?? titleCase(status)),
    basisLabel:
      commitmentState === 'possible'
        ? sourceMeeting
          ? `Possible follow-up · From ${sourceMeeting.title} · ${formatMeetingBasisDate(
              getMeetingTimestamp(sourceMeeting),
            )}`
          : 'Possible follow-up · Owner and due date not confirmed'
        : `${dueLabel} · ${contextLabel ?? sourceLabel}`,
    sourceMeetingId,
    sourceMeetingTitle: sourceMeeting?.title ?? null,
    sourceSynthesis: buildCommitmentSourceSynthesis(action, sourceMeeting),
    canComplete: commitmentState === 'confirmed',
    sourceLabel,
    contextLabel,
    ...attentionContext,
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
    dailyPriorityRank: getDailyPriorityRank(metadata, dateKey),
  };
};

const getPersistedSourceMeeting = (
  action: Entity,
  meetings: Meeting[],
): Meeting | null => {
  const sourceMeetingId = parseActionMetadata(
    action.metadata,
  ).source_meeting_id;
  if (typeof sourceMeetingId !== 'string' || !sourceMeetingId.trim()) {
    return null;
  }
  return (
    meetings.find((meeting) => String(meeting.id) === sourceMeetingId) ?? null
  );
};

const buildActionInsightSummary = (
  possibleCount: number,
  confirmedCount: number,
): string => {
  const possibleVerb = possibleCount === 1 ? 'needs' : 'need';
  const confirmedVerb = confirmedCount === 1 ? 'needs' : 'need';
  if (possibleCount > 0 && confirmedCount > 0) {
    return `${pluralize(possibleCount, 'possible follow-up')} ${possibleVerb} review; ${pluralize(
      confirmedCount,
      'confirmed commitment',
    )} ${confirmedVerb} attention.`;
  }
  if (possibleCount > 0) {
    return `${pluralize(possibleCount, 'possible follow-up')} ${possibleVerb} review before action.`;
  }
  if (confirmedCount > 0) {
    return `${pluralize(confirmedCount, 'confirmed commitment')} ${confirmedVerb} attention.`;
  }
  return 'Nothing is asking for intervention.';
};

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
  dateKey: string,
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
        getPersistedSourceMeeting(action, meetings),
        dateKey,
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
        getPersistedSourceMeeting(action, meetings),
        dateKey,
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
        getPersistedSourceMeeting(action, meetings),
        dateKey,
      );
    }),
  ];
  const seenIds = new Set<string>();
  const deduplicatedItems = prioritizedItems.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
  const possibleCount = deduplicatedItems.filter(
    (item) => item.commitmentState === 'possible',
  ).length;
  const confirmedCount = deduplicatedItems.length - possibleCount;
  const summary = buildActionInsightSummary(possibleCount, confirmedCount);
  const items = deduplicatedItems.slice(0, MAX_ACTION_INSIGHT_ITEMS);

  if (items.length === 0) {
    return {
      state: 'empty',
      overdueCount: 0,
      staleCount: 0,
      activeCount: 0,
      possibleCount: 0,
      confirmedCount: 0,
      summary,
      items: [],
      allItems: [],
    };
  }

  return {
    state: 'populated',
    overdueCount: overdueActions.length,
    staleCount: staleActions.length,
    activeCount: activeActions.length,
    possibleCount,
    confirmedCount,
    summary,
    items,
    allItems: deduplicatedItems,
  };
};

const getActionTrustState = (
  item: DashboardActionInsightItem,
): DashboardTopOfMindItem['trustState'] => {
  if (item.commitmentState === 'possible') return 'weak';
  if (item.status === 'stale') return 'stale';
  if (item.attentionReason) return 'directly supported';
  return 'inferred';
};

const buildActionConsequence = (
  item: DashboardActionInsightItem,
): string | null => {
  if (item.attentionLabel === 'Blocker') {
    return item.attentionReason ?? 'The linked work may stay blocked.';
  }
  return null;
};

const buildTopOfMind = (
  actionInsights: DashboardActionInsights,
): DashboardTopOfMind => {
  const actionItems =
    actionInsights.state === 'populated'
      ? actionInsights.items
          .filter(
            (item) =>
              item.commitmentState === 'confirmed' &&
              (item.status !== 'active' ||
                item.attentionLabel === 'Blocker' ||
                Boolean(item.attentionReason)),
          )
          .slice(0, MAX_DASHBOARD_BRIEFING_ITEMS)
          .map((item) => ({
            id: item.id,
            read:
              item.attentionLabel === 'Blocker'
                ? `${item.title} is blocked.`
                : item.status === 'overdue'
                  ? `${item.title} is overdue.`
                  : item.status === 'stale'
                    ? `${item.title} has gone quiet.`
                    : `${item.title} may need attention.`,
            whyNow: item.attentionReason ?? item.basisLabel,
            consequence: buildActionConsequence(item),
            suggestedMove:
              item.attentionLabel === 'Blocker'
                ? 'Review blocker'
                : item.canComplete
                  ? 'Complete or update'
                  : 'Confirm whether this is real',
            evidenceLabel: item.sourceMeetingId
              ? `Source: ${item.sourceLabel}`
              : item.sourceLabel,
            action: item.sourceMeetingId
              ? {
                  label: 'Open moment',
                  target: 'meeting' as const,
                  meetingId: item.sourceMeetingId,
                }
              : { label: 'Open projects', target: 'projects' as const },
            trustState: getActionTrustState(item),
          }))
      : [];

  if (actionItems.length === 0) {
    return {
      state: 'empty',
      summary: 'Nothing needs your attention',
      items: [],
    };
  }

  return {
    state: 'populated',
    summary: `${pluralize(actionItems.length, 'item')} surfaced`,
    items: actionItems,
  };
};

export const buildDashboardCommitments = (
  actionInsights: DashboardActionInsights,
): DashboardCommitments => {
  const openItems =
    actionInsights.state === 'populated'
      ? actionInsights.allItems
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const aRank = a.item.dailyPriorityRank;
            const bRank = b.item.dailyPriorityRank;
            if (aRank !== null || bRank !== null) {
              if (aRank === null) return 1;
              if (bRank === null) return -1;
              if (aRank !== bRank) return aRank - bRank;
            }
            return a.index - b.index;
          })
          .map(({ item }) => item)
      : [];
  const items = openItems.slice(0, MAX_DASHBOARD_BRIEFING_ITEMS);
  const backlog = openItems.slice(MAX_DASHBOARD_BRIEFING_ITEMS);

  if (items.length === 0) {
    return {
      state: 'empty',
      summary: 'No open action items need attention',
      items: [],
      backlog,
    };
  }

  return {
    state: 'populated',
    summary: `${pluralize(items.length, 'open item')} shown`,
    items,
    backlog,
  };
};

interface MeetingAnalysisRecentWin {
  recent_win?: unknown;
}

interface MeetingRecentWinPayload {
  win?: unknown;
  why_it_counts?: unknown;
  evidence?: unknown;
  source?: unknown;
  ownership?: unknown;
  owner?: unknown;
}

type RecentWinOwnership = 'personal' | 'shared' | 'other' | 'unknown';

const RECENT_WIN_OWNERSHIPS = new Set<RecentWinOwnership>([
  'personal',
  'shared',
  'other',
  'unknown',
]);

const parseRecentWinOwnership = (value: unknown): RecentWinOwnership | null =>
  typeof value === 'string' &&
  RECENT_WIN_OWNERSHIPS.has(value as RecentWinOwnership)
    ? (value as RecentWinOwnership)
    : null;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsSelfAlias = (value: string, selfNames: string[]): boolean =>
  selfNames.some((name) => {
    const alias = name.trim();
    if (alias.length < 2) return false;
    return new RegExp(`(?:^|\\b)${escapeRegex(alias)}(?:\\b|$)`, 'i').test(
      value,
    );
  });

const COLLECTIVE_WIN_SIGNAL = /\b(?:we|we've|we’re|we're|our|ours)\b/i;

const winBelongsToUser = ({
  ownership,
  owner,
  evidence,
  selfNames,
}: {
  ownership: RecentWinOwnership | null;
  owner: string;
  evidence: string;
  selfNames: string[];
}): boolean => {
  if (ownership === 'shared') return true;
  if (ownership === 'other' || ownership === 'unknown') return false;
  if (ownership === 'personal') {
    return (
      containsSelfAlias(owner, selfNames) ||
      containsSelfAlias(evidence, selfNames)
    );
  }
  return (
    containsSelfAlias(evidence, selfNames) ||
    COLLECTIVE_WIN_SIGNAL.test(evidence)
  );
};

const getLocalWeekRange = (dateKey: string): [number, number] => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return [start.getTime(), end.getTime()];
};

const formatWinDateLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

const buildRecentWin = (
  meetings: Meeting[],
  dateKey: string,
  selfNames: string[],
): DashboardWeeklyWins => {
  const [weekStart, weekEnd] = getLocalWeekRange(dateKey);
  const inCurrentWeek = (timestamp: number) =>
    timestamp >= weekStart && timestamp < weekEnd;
  const items: DashboardWeeklyWinItem[] = [];

  for (const meeting of meetings) {
    const timestamp = toTimestamp(getMeetingTimestamp(meeting));
    if (!timestamp || !inCurrentWeek(timestamp)) continue;

    const analysis = parseJsonObject<MeetingAnalysisRecentWin>(
      meeting.analysis_json,
    );
    const recentWin =
      analysis?.recent_win &&
      typeof analysis.recent_win === 'object' &&
      !Array.isArray(analysis.recent_win)
        ? (analysis.recent_win as MeetingRecentWinPayload)
        : null;
    const title =
      meeting.recent_win_title?.trim() ||
      (typeof recentWin?.win === 'string' ? recentWin.win.trim() : '');
    const whyItCounts =
      meeting.recent_win_why?.trim() ||
      (typeof recentWin?.why_it_counts === 'string'
        ? recentWin.why_it_counts.trim()
        : '');
    const evidence =
      meeting.recent_win_evidence?.trim() ||
      (typeof recentWin?.evidence === 'string'
        ? recentWin.evidence.trim()
        : '');
    const ownership = parseRecentWinOwnership(
      meeting.recent_win_ownership ?? recentWin?.ownership,
    );
    const owner =
      meeting.recent_win_owner?.trim() ||
      (typeof recentWin?.owner === 'string' ? recentWin.owner.trim() : '');
    if (
      !title ||
      !whyItCounts ||
      !evidence ||
      !winBelongsToUser({ ownership, owner, evidence, selfNames })
    ) {
      continue;
    }

    items.push({
      id: `meeting-win:${meeting.id}`,
      kind: 'evidence',
      title,
      whyItCounts,
      sourceLabel:
        meeting.recent_win_source?.trim() ||
        (typeof recentWin?.source === 'string' && recentWin.source.trim()
          ? recentWin.source.trim()
          : meeting.title || 'Recent meeting'),
      dateLabel: formatWinDateLabel(timestamp),
      timestamp,
      meetingId: meeting.id,
    });
  }

  const firstMeeting = [...meetings]
    .filter((meeting) => toTimestamp(getMeetingTimestamp(meeting)) > 0)
    .sort(
      (a, b) =>
        toTimestamp(getMeetingTimestamp(a)) -
        toTimestamp(getMeetingTimestamp(b)),
    )[0];
  const firstMeetingTimestamp = firstMeeting
    ? toTimestamp(getMeetingTimestamp(firstMeeting))
    : 0;
  if (firstMeeting && inCurrentWeek(firstMeetingTimestamp)) {
    items.push({
      id: `first-meeting:${firstMeeting.id}`,
      kind: 'milestone',
      title: 'First meeting with Pluto — done',
      whyItCounts:
        'You captured your first meeting and started building momentum.',
      sourceLabel: firstMeeting.title || 'First meeting',
      dateLabel: formatWinDateLabel(firstMeetingTimestamp),
      timestamp: firstMeetingTimestamp,
      meetingId: firstMeeting.id,
    });
  }

  items.sort(
    (a, b) =>
      b.timestamp - a.timestamp ||
      Number(a.kind === 'milestone') - Number(b.kind === 'milestone'),
  );
  if (items.length) {
    return { state: 'populated', items, total: items.length };
  }

  return {
    state: 'empty',
    title: meetings.length
      ? 'No wins yet this week'
      : 'Your wins will show up here',
    detail: meetings.length
      ? 'Pluto is looking for supported moments like praise, delivered work, closed business, and revenue won.'
      : 'Record your first meeting to start building a list of evidence-backed wins.',
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
  hero: DashboardHero,
  briefingFocus: DashboardBriefingFocus,
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
    const hasBlockedFollowUpState =
      hero.label === 'Blocked' ||
      briefingFocus.title === 'Blocked follow-up' ||
      briefingFocus.title === 'Blocked follow-ups';
    actions.push({
      label:
        hasBlockedFollowUpState ||
        (actionInsights.state === 'empty' && spotlight?.hasBlockers)
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
  overdueActions: Entity[],
  activeActions: Entity[],
  staleActions: Entity[],
  attentionAlerts: AttentionItem[],
): DashboardBriefingFocus => {
  if (
    actionInsights.state === 'populated' &&
    overdueActions.length > 0 &&
    hero.kind === 'overdue_action'
  ) {
    const prioritizedOverdueAction = sortActions(overdueActions, (a, b) =>
      compareOverdueDashboardActions(a, b, attentionAlerts),
    )[0];
    const blockedOverdueCount = overdueActions.filter((action) =>
      hasActiveLinkedBlocker(action.id, attentionAlerts),
    ).length;
    const blockerReason = prioritizedOverdueAction
      ? getActiveLinkedBlockerReason(
          prioritizedOverdueAction.id,
          attentionAlerts,
        )
      : null;
    if (prioritizedOverdueAction && blockedOverdueCount > 0) {
      return {
        kind: 'attention',
        title:
          blockedOverdueCount === 1
            ? 'Blocked follow-up'
            : 'Blocked follow-ups',
        detail: blockerReason ?? pluralize(blockedOverdueCount, 'blocked item'),
        action: { label: 'Review blockers', target: 'projects' },
      };
    }
  }

  if (actionInsights.state === 'populated' && overdueActions.length > 0) {
    const hasBlockedUrgentFollowUp =
      hero.kind === 'overdue_action' && hero.label === 'Blocked';
    return {
      kind: 'attention',
      title: hasBlockedUrgentFollowUp ? 'Blocked follow-up' : 'Needs attention',
      detail: joinCountLabels([
        overdueActions.length > 0
          ? pluralize(overdueActions.length, 'overdue item')
          : '',
        staleActions.length > 0
          ? pluralize(staleActions.length, 'stale item')
          : '',
      ]),
      action: {
        label:
          (hero.kind === 'overdue_action' || hero.kind === 'stale_action') &&
          hero.label === 'Blocked'
            ? 'Review blockers'
            : 'Review actions',
        target: 'projects',
      },
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

  if (actionInsights.state === 'populated' && staleActions.length > 0) {
    return {
      kind: 'attention',
      title: 'Needs attention',
      detail: pluralize(staleActions.length, 'stale item'),
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
    activeActions.length > 0 &&
    hero.kind === 'active_action' &&
    hero.severity === 'watch'
  ) {
    return {
      kind: 'attention',
      title: 'Needs attention',
      detail: pluralize(activeActions.length, 'active item'),
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
  const selfOptions: ThirdPartyAssigneeOptions = {
    selfPersonId: input.selfPersonId,
    selfNames: input.selfNames,
  };
  const isPersonalAction = (action: Entity) =>
    !isThirdPartyAction(action, selfOptions);

  const rawOverdue = input.overdueActions.filter(isPersonalAction);
  const rawStale = input.staleActions.filter(isPersonalAction);
  const rawActive = input.activeActions.filter(isPersonalAction);

  const openOverdueActions = filterRejectedDashboardActions(rawOverdue);
  const openStaleActions = filterRejectedDashboardActions(rawStale);
  const openActiveActions = filterRejectedDashboardActions(rawActive);

  const overdueActions = filterSuppressedDashboardActions(
    openOverdueActions,
    attentionAlerts,
  );
  const staleActions = filterSuppressedDashboardActions(
    openStaleActions,
    attentionAlerts,
  );
  const activeActions = filterSuppressedDashboardActions(
    openActiveActions,
    attentionAlerts,
  );
  const confirmedOverdueActions =
    filterConfirmedDashboardActions(overdueActions);
  const confirmedStaleActions = filterConfirmedDashboardActions(staleActions);
  const confirmedActiveActions = filterConfirmedDashboardActions(activeActions);
  const latestMeeting = buildLatestMeeting(input.meetings);
  const actionInsights = buildActionInsights(
    input.meetings,
    overdueActions,
    staleActions,
    activeActions,
    attentionAlerts,
    input.dateKey ?? getDashboardDateKey(),
  );
  const topOfMind = buildTopOfMind(actionInsights);
  const commitmentActionInsights = buildActionInsights(
    input.meetings,
    openOverdueActions,
    openStaleActions,
    openActiveActions,
    attentionAlerts,
    input.dateKey ?? getDashboardDateKey(),
  );
  const commitments = buildDashboardCommitments(commitmentActionInsights);
  const recentWin = buildRecentWin(
    input.meetings,
    input.dateKey ?? getDashboardDateKey(),
    input.selfNames ?? [],
  );
  const knowledgeDocuments = buildKnowledgeDocuments(
    input.workspace,
    workingMemorySnapshots,
  );
  const spotlight = buildSpotlight(input.workspace);
  const hero = buildHero(
    {
      ...input,
      overdueActions: confirmedOverdueActions,
      staleActions: confirmedStaleActions,
      activeActions: confirmedActiveActions,
    },
    latestMeeting,
    knowledgeDocuments,
  );
  const briefingFocus = buildBriefingFocus(
    hero,
    actionInsights,
    latestMeeting,
    knowledgeDocuments,
    confirmedOverdueActions,
    confirmedActiveActions,
    confirmedStaleActions,
    attentionAlerts,
  );

  return {
    hero,
    topOfMind,
    commitments,
    recentWin,
    briefingFocus,
    latestMeeting,
    actionInsights,
    knowledgeDocuments,
    spotlight,
    quickActions: buildQuickActions(
      hero,
      briefingFocus,
      latestMeeting,
      actionInsights,
      knowledgeDocuments,
      spotlight,
    ),
    graphStats: input.graphStats,
  };
};
