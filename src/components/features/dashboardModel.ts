import type { KnowledgeDoc } from '../../api/knowledgeDocs';
import type { Entity, KnowledgeGraphStats } from '../../api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../api/knowledgeWorkspace';
import type { Meeting } from '../../types';

export type DashboardTarget = 'ask' | 'meeting' | 'projects' | 'wiki';

export interface DashboardAction {
  label: string;
  target: DashboardTarget;
  meetingId?: Meeting['id'];
}

export type DashboardHeroKind =
  | 'recording'
  | 'overdue_action'
  | 'stale_action'
  | 'latest_meeting'
  | 'knowledge_doc'
  | 'default';

export interface DashboardHero {
  kind: DashboardHeroKind;
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
  status: KnowledgeDoc['status'];
  scopeType: KnowledgeDoc['scope_type'];
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
  detail: string;
  tags: string[];
  target: DashboardTarget;
}

export interface DashboardHomeModelInput {
  isRecording: boolean;
  meetings: Meeting[];
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  workspace: KnowledgeWorkspacePayload | null;
  graphStats: KnowledgeGraphStats | null;
}

export interface DashboardHomeModel {
  hero: DashboardHero;
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

const getMeetingDetail = (meeting: Meeting): string => {
  const analysis = parseJsonObject<MeetingAnalysisOverview>(
    meeting.analysis_json,
  );
  if (typeof analysis?.overview === 'string' && analysis.overview.trim()) {
    return analysis.overview.trim();
  }
  if (meeting.enhanced_notes?.trim()) return meeting.enhanced_notes.trim();
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
): DashboardActionInsightItem => ({
  id: action.id,
  title: action.name,
  dueLabel: formatDueLabel(action.due_date),
  status,
  sourceLabel: titleCase(action.domain_tag || 'workspace'),
});

const buildActionInsights = (
  overdueActions: Entity[],
  staleActions: Entity[],
  activeActions: Entity[],
): DashboardActionInsights => {
  const items = [
    ...overdueActions.map((action) => actionToInsightItem(action, 'overdue')),
    ...staleActions.map((action) => actionToInsightItem(action, 'stale')),
    ...activeActions.map((action) => actionToInsightItem(action, 'active')),
  ];

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

const buildKnowledgeDocuments = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardKnowledgeDocuments => {
  const docs = workspace?.docs ?? [];
  if (docs.length === 0) {
    return {
      state: 'empty',
      cards: [],
    };
  }

  const cards = sortByNewestTimestamp(docs, (doc) => doc.updated_at)
    .slice(0, 4)
    .map((doc) => {
      const sourceCount = getKnowledgeDocSourceCount(doc);
      return {
        id: doc.id,
        title: doc.title,
        description: getKnowledgeDocHeadline(doc),
        countLabel: formatCountLabel(sourceCount),
        status: doc.status,
        scopeType: doc.scope_type,
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

const buildSpotlight = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardSpotlight | null => {
  const card = [...(workspace?.project_cards ?? [])].sort(
    (a, b) => getProjectPriorityScore(b) - getProjectPriorityScore(a),
  )[0];
  if (!card) return null;

  const tags = [
    card.open_blockers > 0 ? pluralize(card.open_blockers, 'blocker') : '',
    card.dependency_count > 0
      ? pluralize(card.dependency_count, 'dependency', 'dependencies')
      : '',
    card.recent_changes > 0
      ? pluralize(card.recent_changes, 'recent change')
      : '',
    card.staleness_days > 7 ? `${card.staleness_days}d stale` : '',
  ].filter(Boolean);

  return {
    title: card.title,
    subtitle: 'Project spotlight',
    detail: tags.length > 0 ? tags.join(' | ') : 'No blockers surfaced',
    tags,
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
      title: 'Recording in progress',
      detail: 'Pluto is listening and will synthesize this conversation next.',
      severity: 'live',
      action: { label: 'Ask Pluto', target: 'ask' },
    };
  }

  const overdueAction = input.overdueActions[0];
  if (overdueAction) {
    return {
      kind: 'overdue_action',
      title: pluralize(input.overdueActions.length, 'overdue item'),
      detail: `${overdueAction.name} needs attention.`,
      severity: 'urgent',
      action: { label: 'Open projects', target: 'projects' },
    };
  }

  const staleAction = input.staleActions[0];
  if (staleAction) {
    return {
      kind: 'stale_action',
      title: pluralize(input.staleActions.length, 'stale item'),
      detail: `${staleAction.name} has gone quiet.`,
      severity: 'watch',
      action: { label: 'Open projects', target: 'projects' },
    };
  }

  if (latestMeeting.state === 'populated') {
    return {
      kind: 'latest_meeting',
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
      title: doc.title,
      detail: doc.description,
      severity: 'calm',
      action: { label: 'Knowledge home', target: 'wiki' },
    };
  }

  return {
    kind: 'default',
    title: 'You are all caught up',
    detail:
      'Record a meeting or open knowledge to build your workspace memory.',
    severity: 'calm',
    action: { label: 'Ask Pluto', target: 'ask' },
  };
};

const buildQuickActions = (
  latestMeeting: DashboardLatestMeeting,
  actionInsights: DashboardActionInsights,
  knowledgeDocuments: DashboardKnowledgeDocuments,
  spotlight: DashboardSpotlight | null,
): DashboardAction[] => {
  const actions: DashboardAction[] = [{ label: 'Ask Pluto', target: 'ask' }];

  if (latestMeeting.state === 'populated') {
    actions.push({
      label: 'Review latest',
      target: 'meeting',
      meetingId: latestMeeting.meetingId,
    });
  }

  if (actionInsights.state === 'populated' || spotlight) {
    actions.push({ label: 'Open projects', target: 'projects' });
  }

  if (knowledgeDocuments.state === 'populated') {
    actions.push({ label: 'Knowledge home', target: 'wiki' });
  }

  return actions;
};

export const buildDashboardHomeModel = (
  input: DashboardHomeModelInput,
): DashboardHomeModel => {
  const latestMeeting = buildLatestMeeting(input.meetings);
  const actionInsights = buildActionInsights(
    input.overdueActions,
    input.staleActions,
    input.activeActions,
  );
  const knowledgeDocuments = buildKnowledgeDocuments(input.workspace);
  const spotlight = buildSpotlight(input.workspace);

  return {
    hero: buildHero(input, latestMeeting, knowledgeDocuments),
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
