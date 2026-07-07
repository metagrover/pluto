import { type Entity, parseMetadata } from '../../api/knowledgeGraph';
import type { AnalysisDocumentV3, DecisionV3, TopicSection } from '../../types';
import type { MeetingLinkedAttentionItem } from './meetingActionItems';

type MeetingEntitySummary = Entity & {
  mention_count: number;
  context: string | null;
};

interface FollowUpDraftContextInput {
  fallbackActionItems: string[];
  fallbackDecisions?: string[];
  linkedEntities: MeetingEntitySummary[];
  linkedAttentionItems?: MeetingLinkedAttentionItem[];
}

interface FollowUpDraftActionItemInput {
  text: string;
  topic?: string;
  assignee?: string;
  due?: string;
}

interface FallbackActionDetails {
  topic: string;
  status: string;
  owner: string;
  due: string;
  context: string;
}

interface OwnerLabel {
  name: string;
  role: string;
}

export interface FollowUpDraftContext {
  actionItems: string[];
  decisions: string[];
  participants: string[];
  entityContext: string[];
}

interface FollowUpDraftDecisionsInput {
  fallbackDecisions: string[];
  analysis?: AnalysisDocumentV3 | null;
}

export interface DefaultDraftsInput {
  meetingTitle: string;
  overview: string[];
  actionItems: string[];
  decisions: string[];
  entityContext?: string[];
  discussionPoints?: string[];
  participants: string[];
  openQuestions?: string[];
  topicSummaries?: string[];
}

export type DraftId = 'client' | 'internal' | 'slack';
export type Drafts = Partial<Record<DraftId, string>>;

const normalizeName = (value: string | null | undefined): string =>
  (value || '').trim();

const stripKnownActionItemDetails = (value: string): string =>
  value
    .replace(/\s+\((?:Topic|Owner|Due|Status|Context|Decided by|Why): .*$/i, '')
    .trim();

const normalizeKey = (value: string | null | undefined): string =>
  stripKnownActionItemDetails(normalizeName(value)).toLowerCase();

const splitFormattedDetails = (
  value: string,
): { baseText: string; details: string[] } => {
  const normalized = normalizeName(value);
  const match = normalized.match(/^(.*?)(?: \((.+)\))?$/);
  if (!match) {
    return { baseText: normalized, details: [] };
  }

  const [, baseText, detailText] = match;
  return {
    baseText: normalizeName(baseText),
    details: detailText
      ? detailText
          .split(' | ')
          .map((detail) => normalizeName(detail))
          .filter(Boolean)
      : [],
  };
};

interface DecisionDetailParts {
  topic: string;
  decidedBy: string;
  why: string;
  extra: string[];
}

const getDecisionDetailLabel = (value: string): string => {
  const match = value.match(/^([^:]+):/);
  return match ? normalizeKey(match[1]) : '';
};

const parseDecisionDetailParts = (value?: string): DecisionDetailParts => {
  const parts: DecisionDetailParts = {
    topic: '',
    decidedBy: '',
    why: '',
    extra: [],
  };
  if (!value) return parts;

  const { details } = splitFormattedDetails(value);
  for (const detail of details) {
    const label = getDecisionDetailLabel(detail);
    if (label === 'topic') {
      parts.topic = detail;
      continue;
    }
    if (label === 'decided by') {
      parts.decidedBy = detail;
      continue;
    }
    if (label === 'why') {
      parts.why = detail;
      continue;
    }
    parts.extra.push(detail);
  }

  return parts;
};

const mergeDecisionDetails = (
  formattedDecision: string,
  fallbackDecision?: string,
): string => {
  if (!fallbackDecision) return formattedDecision;

  const baseText = splitFormattedDetails(formattedDecision).baseText;
  const primary = parseDecisionDetailParts(formattedDecision);
  const fallback = parseDecisionDetailParts(fallbackDecision);
  const extras: string[] = [];
  const extraKeys = new Set<string>();

  for (const detail of [...fallback.extra, ...primary.extra]) {
    const key = normalizeKey(detail);
    if (!key || extraKeys.has(key)) continue;
    extraKeys.add(key);
    extras.push(detail);
  }

  const details = [
    primary.topic || fallback.topic,
    mergeDecisionOwnerDetail(primary.decidedBy, fallback.decidedBy),
    primary.why || fallback.why,
    ...extras,
  ].filter(Boolean);

  return details.length > 0 ? `${baseText} (${details.join(' | ')})` : baseText;
};

const parseRoleFromMetadata = (value: string | null | undefined): string => {
  const normalized = normalizeName(value);
  if (!normalized) return '';

  try {
    const parsed = JSON.parse(normalized) as { role?: unknown };
    return typeof parsed.role === 'string' ? normalizeName(parsed.role) : '';
  } catch {
    return '';
  }
};

const parseRoleFromContext = (value: string | null | undefined): string => {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const match = normalized.match(/^Role:\s*(.+)$/i);
  return match ? normalizeName(match[1]) : '';
};

const getDetailValue = (value: string): string => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return normalizeName(value);
  return normalizeName(value.slice(separatorIndex + 1));
};

const parseOwnerLabel = (value: string): OwnerLabel => {
  const normalized = normalizeName(value);
  if (!normalized) return { name: '', role: '' };

  const match = normalized.match(/^(.*?)\s+\((.+)\)$/);
  if (!match) {
    return { name: normalized, role: '' };
  }

  return {
    name: normalizeName(match[1]),
    role: normalizeName(match[2]),
  };
};

const mergeDecisionOwnerDetail = (
  primaryDetail: string,
  fallbackDetail: string,
): string => {
  if (!primaryDetail) return fallbackDetail;
  if (!fallbackDetail) return primaryDetail;

  const primaryOwner = parseOwnerLabel(getDetailValue(primaryDetail));
  const fallbackOwner = parseOwnerLabel(getDetailValue(fallbackDetail));

  if (
    primaryOwner.name &&
    fallbackOwner.name &&
    primaryOwner.name === fallbackOwner.name &&
    !primaryOwner.role &&
    fallbackOwner.role
  ) {
    return `Decided by: ${fallbackOwner.name} (${fallbackOwner.role})`;
  }

  return primaryDetail;
};

const compareEntities = (a: MeetingEntitySummary, b: MeetingEntitySummary) => {
  if (b.mention_count !== a.mention_count) {
    return b.mention_count - a.mention_count;
  }
  return a.name.localeCompare(b.name);
};

const getDraftActionPriority = (
  entity: MeetingEntitySummary,
  blockerReason: string,
  fallbackDetails: FallbackActionDetails,
): number => {
  const fallbackStatus = normalizeName(fallbackDetails.status).toLowerCase();
  if (blockerReason || fallbackStatus.startsWith('blocked')) return 0;
  if (entity.status === 'overdue' || fallbackStatus === 'overdue') return 1;
  if (entity.status === 'stale' || fallbackStatus === 'stale') return 2;
  return 3;
};

const formatDueLabel = (value: string | null | undefined): string => {
  const normalized = normalizeName(value);
  if (!normalized) return '';

  const timestamp = new Date(normalized).getTime();
  if (Number.isNaN(timestamp)) return normalized;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const formatLifecycleLabel = (
  value: MeetingEntitySummary['status'],
): string => {
  if (value === 'overdue') return 'Overdue';
  if (value === 'stale') return 'Stale';
  return '';
};

const getFallbackLifecyclePriority = (value: string): number => {
  const status = getFallbackActionDetails(value).status.toLowerCase();

  if (status.startsWith('blocked')) return 0;
  if (status === 'overdue') return 1;
  if (status === 'stale') return 2;

  return 3;
};

const getFallbackActionDetails = (value: string): FallbackActionDetails => {
  const detailsMatch = value.match(/\((.+)\)\s*$/);
  if (!detailsMatch) {
    return { topic: '', status: '', owner: '', due: '', context: '' };
  }

  const fallbackDetails: FallbackActionDetails = {
    topic: '',
    status: '',
    owner: '',
    due: '',
    context: '',
  };

  for (const detail of detailsMatch[1].split('|')) {
    const normalized = normalizeName(detail);
    const lower = normalized.toLowerCase();
    if (lower.startsWith('topic:')) {
      fallbackDetails.topic = normalizeName(normalized.slice('topic:'.length));
      continue;
    }
    if (lower.startsWith('status:')) {
      fallbackDetails.status = normalizeName(
        normalized.slice('status:'.length),
      );
      continue;
    }
    if (lower.startsWith('owner:')) {
      fallbackDetails.owner = normalizeName(normalized.slice('owner:'.length));
      continue;
    }
    if (lower.startsWith('due:')) {
      fallbackDetails.due = normalizeName(normalized.slice('due:'.length));
      continue;
    }
    if (lower.startsWith('context:')) {
      fallbackDetails.context = normalizeName(
        normalized.slice('context:'.length),
      );
    }
  }

  return fallbackDetails;
};

const formatActionItem = (
  entity: MeetingEntitySummary,
  peopleById: Map<string, { name: string; role: string }>,
  blockerReasonByEntityId: Map<string, string>,
  fallbackDetails: FallbackActionDetails,
): string => {
  const ownerId = normalizeName(entity.assigned_to);
  const owner = ownerId ? peopleById.get(ownerId) : null;
  const fallbackOwner = parseOwnerLabel(fallbackDetails.owner);
  const ownerName = owner?.name || fallbackOwner.name || ownerId;
  const ownerMatchesFallback =
    !owner?.name ||
    normalizeKey(owner.name) === normalizeKey(fallbackOwner.name);
  const ownerRole =
    owner?.role || (ownerMatchesFallback ? fallbackOwner.role : '');
  const dueLabel = formatDueLabel(entity.due_date) || fallbackDetails.due;
  const contextLabel = normalizeName(entity.context) || fallbackDetails.context;
  const blockedReason = blockerReasonByEntityId.get(entity.id) ?? '';
  const lifecycleLabel =
    formatLifecycleLabel(entity.status) ||
    (blockedReason ? '' : fallbackDetails.status);
  const details = [
    fallbackDetails.topic ? `Topic: ${fallbackDetails.topic}` : '',
    lifecycleLabel ? `Status: ${lifecycleLabel}` : '',
    ownerName
      ? `Owner: ${ownerRole ? `${ownerName} (${ownerRole})` : ownerName}`
      : '',
    dueLabel ? `Due: ${dueLabel}` : '',
    contextLabel ? `Context: ${contextLabel}` : '',
    blockedReason ? `Status: ${blockedReason}` : '',
  ].filter(Boolean);

  return details.length > 0
    ? `${entity.name} (${details.join(' | ')})`
    : entity.name;
};

const formatDecisionItem = (entity: MeetingEntitySummary): string => {
  const metadata = parseMetadata<{ rationale?: unknown }>(entity);
  const metadataRationale =
    typeof metadata?.rationale === 'string'
      ? normalizeName(metadata.rationale)
      : '';
  const contextRationale = normalizeName(entity.context);
  const rationaleCandidates = [metadataRationale, contextRationale].filter(
    Boolean,
  );
  const rationale = rationaleCandidates.find(
    (candidate) => normalizeKey(candidate) !== normalizeKey(entity.name),
  );

  return rationale ? `${entity.name} (Why: ${rationale})` : entity.name;
};

const mergeDecisionItem = (
  entity: MeetingEntitySummary,
  fallbackDecision?: string,
): string => {
  if (!fallbackDecision) return formatDecisionItem(entity);

  const { details } = splitFormattedDetails(fallbackDecision);
  const detailKeys = new Set(details.map((detail) => normalizeKey(detail)));
  const formattedEntityDecision = formatDecisionItem(entity);
  const { details: entityDetails } = splitFormattedDetails(
    formattedEntityDecision,
  );

  for (const detail of entityDetails) {
    const key = normalizeKey(detail);
    if (detailKeys.has(key)) continue;
    detailKeys.add(key);
    details.push(detail);
  }

  return details.length > 0
    ? `${entity.name} (${details.join(' | ')})`
    : entity.name;
};

const formatParticipant = (entity: MeetingEntitySummary): string => {
  const metadata = parseMetadata<{ role?: unknown }>(entity);
  const role =
    typeof metadata?.role === 'string' ? normalizeName(metadata.role) : '';

  return role ? `${entity.name} (${role})` : entity.name;
};

const formatDecisionWithDetails = (
  decision: DecisionV3,
  topicTitle = '',
): string => {
  const text = normalizeName(decision.text);
  const details = [
    topicTitle ? `Topic: ${topicTitle}` : '',
    normalizeName(decision.decided_by)
      ? `Decided by: ${normalizeName(decision.decided_by)}`
      : '',
    normalizeName(decision.rationale)
      ? `Why: ${normalizeName(decision.rationale)}`
      : '',
  ].filter(Boolean);

  return details.length > 0 ? `${text} (${details.join(' | ')})` : text;
};

const formatEntityContext = (entity: MeetingEntitySummary): string | null => {
  if (entity.type === 'project') {
    return `Project: ${entity.name}`;
  }
  if (entity.type === 'topic') {
    return `Topic: ${entity.name}`;
  }
  return null;
};

export const buildFollowUpDraftContext = ({
  fallbackActionItems,
  fallbackDecisions = [],
  linkedEntities,
  linkedAttentionItems = [],
}: FollowUpDraftContextInput): FollowUpDraftContext => {
  const people = linkedEntities
    .filter((entity) => entity.type === 'person')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const peopleById = new Map(
    people.map((entity) => [
      entity.id,
      {
        name: entity.name,
        role:
          parseRoleFromMetadata(entity.metadata) ||
          parseRoleFromContext(entity.context),
      },
    ]),
  );
  const suppressedEntityIds = new Set(
    linkedAttentionItems
      .filter(
        (item) => item.status === 'dismissed' || item.status === 'snoozed',
      )
      .flatMap((item) => item.related_entity_ids),
  );

  const blockerReasonByEntityId = new Map<string, string>();
  for (const item of linkedAttentionItems) {
    if (item.kind !== 'blocker' || item.status !== 'active') continue;
    const reason = normalizeName(item.reason).replace(/[.!?]+$/, '');
    if (!reason) continue;
    for (const relatedEntityId of item.related_entity_ids) {
      if (blockerReasonByEntityId.has(relatedEntityId)) continue;
      blockerReasonByEntityId.set(relatedEntityId, reason);
    }
  }

  const allLinkedActionEntities = linkedEntities
    .filter((entity) => entity.type === 'action_item')
    .filter((entity) => normalizeName(entity.name));
  const fallbackDetailsByActionKey = new Map(
    fallbackActionItems
      .map(
        (item) => [normalizeKey(item), getFallbackActionDetails(item)] as const,
      )
      .filter(([, details]) => Object.values(details).some(Boolean)),
  );
  const actionEntities = allLinkedActionEntities
    .filter((entity) => entity.status !== 'completed')
    .filter((entity) => !suppressedEntityIds.has(entity.id))
    .sort((left, right) => {
      const leftFallback = fallbackDetailsByActionKey.get(
        normalizeKey(left.name),
      ) ?? {
        topic: '',
        status: '',
        owner: '',
        due: '',
        context: '',
      };
      const rightFallback = fallbackDetailsByActionKey.get(
        normalizeKey(right.name),
      ) ?? {
        topic: '',
        status: '',
        owner: '',
        due: '',
        context: '',
      };
      const leftPriority = getDraftActionPriority(
        left,
        blockerReasonByEntityId.get(left.id) ?? '',
        leftFallback,
      );
      const rightPriority = getDraftActionPriority(
        right,
        blockerReasonByEntityId.get(right.id) ?? '',
        rightFallback,
      );
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return compareEntities(left, right);
    });
  const linkedActionNames = new Set(
    allLinkedActionEntities.map((entity) => normalizeKey(entity.name)),
  );
  const actionItems = actionEntities.map((entity) =>
    formatActionItem(
      entity,
      peopleById,
      blockerReasonByEntityId,
      fallbackDetailsByActionKey.get(normalizeKey(entity.name)) ?? {
        topic: '',
        status: '',
        owner: '',
        due: '',
        context: '',
      },
    ),
  );
  const fallbackOnlyItems = fallbackActionItems.filter(
    (item) => !linkedActionNames.has(normalizeKey(item)),
  );
  const prioritizedFallbackOnlyItems = fallbackOnlyItems
    .filter((item) => getFallbackLifecyclePriority(item) < 3)
    .sort(
      (a, b) =>
        getFallbackLifecyclePriority(a) - getFallbackLifecyclePriority(b),
    );
  const routineFallbackOnlyItems = fallbackOnlyItems.filter(
    (item) => getFallbackLifecyclePriority(item) === 3,
  );
  const decisionEntities = linkedEntities
    .filter((entity) => entity.type === 'decision')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const fallbackDecisionByKey = new Map(
    fallbackDecisions.map((decision) => [normalizeKey(decision), decision]),
  );
  const linkedDecisionNames = new Set(
    decisionEntities.map((entity) => normalizeKey(entity.name)),
  );
  const fallbackOnlyDecisions = fallbackDecisions.filter(
    (item) => !linkedDecisionNames.has(normalizeKey(item)),
  );
  const entityContext: string[] = [];
  const entityContextKeys = new Set<string>();

  for (const entity of linkedEntities
    .filter((candidate) => normalizeName(candidate.name))
    .sort(compareEntities)) {
    const formatted = formatEntityContext(entity);
    if (!formatted) continue;

    const key = normalizeKey(formatted);
    if (entityContextKeys.has(key)) continue;
    entityContextKeys.add(key);
    entityContext.push(formatted);
  }

  return {
    actionItems:
      actionItems.length > 0
        ? [
            ...prioritizedFallbackOnlyItems,
            ...actionItems,
            ...routineFallbackOnlyItems,
          ]
        : fallbackActionItems,
    decisions:
      decisionEntities.length > 0
        ? [
            ...decisionEntities.map((entity) =>
              mergeDecisionItem(
                entity,
                fallbackDecisionByKey.get(normalizeKey(entity.name)),
              ),
            ),
            ...fallbackOnlyDecisions,
          ]
        : fallbackDecisions,
    participants: people.map(formatParticipant),
    entityContext,
  };
};

export const buildFollowUpDraftOpenQuestions = (
  topics: Pick<TopicSection, 'title' | 'open_questions'>[] | null | undefined,
): string[] => {
  if (!topics?.length) return [];

  const seen = new Set<string>();
  const questions: string[] = [];

  for (const topic of topics) {
    const topicTitle = normalizeName(topic.title);

    for (const question of topic.open_questions || []) {
      const normalizedQuestion = normalizeName(question);
      if (!normalizedQuestion) continue;

      const line = topicTitle
        ? `${topicTitle}: ${normalizedQuestion}`
        : normalizedQuestion;
      const key = normalizeKey(line);

      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(line);
    }
  }

  return questions;
};

export const buildFollowUpDraftDecisions = ({
  fallbackDecisions,
  analysis,
}: FollowUpDraftDecisionsInput): string[] => {
  if (!analysis) return fallbackDecisions;

  const seen = new Set<string>();
  const decisions: string[] = [];

  for (const topic of analysis.topics) {
    const topicTitle = normalizeName(topic.title);
    for (const decision of topic.decisions) {
      const text = normalizeName(decision.text);
      if (!text) continue;

      const key = normalizeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      decisions.push(
        mergeDecisionDetails(
          formatDecisionWithDetails(decision, topicTitle),
          fallbackDecisions.find(
            (fallbackDecision) => normalizeKey(fallbackDecision) === key,
          ),
        ),
      );
    }
  }

  for (const decision of analysis.all_decisions) {
    const text = normalizeName(decision.text);
    if (!text) continue;

    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    decisions.push(
      mergeDecisionDetails(
        formatDecisionWithDetails(decision),
        fallbackDecisions.find(
          (fallbackDecision) => normalizeKey(fallbackDecision) === key,
        ),
      ),
    );
  }

  const fallbackOnlyDecisions = fallbackDecisions.filter(
    (decision) => !seen.has(normalizeKey(decision)),
  );

  return decisions.length > 0
    ? [...decisions, ...fallbackOnlyDecisions]
    : fallbackDecisions;
};

export const formatFollowUpDraftActionItem = ({
  text,
  topic,
  assignee,
  due,
}: FollowUpDraftActionItemInput): string => {
  const baseText = normalizeName(text);
  const details = [
    normalizeName(topic) ? `Topic: ${normalizeName(topic)}` : '',
    normalizeName(assignee) ? `Owner: ${normalizeName(assignee)}` : '',
    normalizeName(due) ? `Due: ${normalizeName(due)}` : '',
  ].filter(Boolean);

  return details.length > 0 ? `${baseText} (${details.join(' | ')})` : baseText;
};

const toBullets = (items: string[], fallback: string) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : fallback;

export const buildFollowUpDraftTopicSummaries = (
  topics: Array<{ title?: string | null; summary?: string | null }>,
): string[] => {
  const seen = new Set<string>();
  const topicSummaries: string[] = [];

  for (const topic of topics) {
    const title = normalizeName(topic.title);
    const summary = normalizeName(topic.summary);
    if (!summary) continue;

    const formatted = title ? `${title}: ${summary}` : summary;
    const normalized = normalizeKey(formatted);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    topicSummaries.push(formatted);
  }

  return topicSummaries;
};

export const buildFollowUpDraftDiscussionPoints = (
  topics: TopicSection[] | null | undefined,
): string[] => {
  if (!topics?.length) return [];

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const topic of topics) {
    const topicTitle = normalizeName(topic.title);
    for (const point of topic.key_points || []) {
      const pointText = normalizeName(point.text);
      if (!pointText) continue;

      const line = topicTitle ? `${topicTitle}: ${pointText}` : pointText;
      const key = normalizeKey(pointText);
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }

  return lines;
};

export const buildDefaultDrafts = ({
  meetingTitle,
  overview,
  actionItems,
  decisions,
  entityContext = [],
  discussionPoints = [],
  participants,
  openQuestions = [],
  topicSummaries = [],
}: DefaultDraftsInput): Drafts => {
  const overviewLines = overview.map(normalizeName).filter(Boolean);
  const overviewBlock = overviewLines.length
    ? `\n\nContext:\n${toBullets(overviewLines, '- None')}`
    : '';
  const slackOverviewBlock = overviewLines.length
    ? `\n\n*Context:*\n${toBullets(overviewLines, '- None')}`
    : '';
  const actions = toBullets(actionItems, '- None');
  const decisionBullets = toBullets(decisions, '- None');
  const entityContextBullets = toBullets(entityContext, '- None');
  const openQuestionBullets = toBullets(openQuestions, '- None');
  const discussionContext = [...topicSummaries, ...discussionPoints];
  const discussionBlock = discussionContext.length
    ? `\n\nDiscussion Context:\n${toBullets(discussionContext, '- None')}`
    : '';
  const participantLine = participants.length
    ? `\nParticipants: ${participants.join(', ')}`
    : '';
  const entityContextBlock = entityContext.length
    ? `\nLinked Context:\n${entityContextBullets}`
    : '';
  const slackParticipantBlock = participants.length
    ? `\n*Participants:* ${participants.join(', ')}\n`
    : '\n';
  const openQuestionBlock = openQuestions.length
    ? `\n\nOpen Questions:\n${openQuestionBullets}`
    : '';
  const slackOpenQuestionBlock = openQuestions.length
    ? `\n\n*Open Questions:*\n${openQuestionBullets}`
    : '';
  const slackDiscussionBlock = discussionContext.length
    ? `\n*Discussion Context:*\n${toBullets(discussionContext, '- None')}\n`
    : '';
  const slackEntityContextBlock = entityContext.length
    ? `\n*Linked Context:*\n${entityContextBullets}\n`
    : '';

  return {
    client: `Subject: Recap: ${meetingTitle}\n\nHi Team,\n\nMeeting: ${meetingTitle}${participantLine}${overviewBlock}${entityContextBlock}${discussionBlock}\n\nDecisions:\n${decisionBullets}\n\nNext Steps:\n${actions}${openQuestionBlock}`,
    internal: `Team, session on ${meetingTitle}:${participantLine}${overviewBlock}${entityContextBlock}${discussionBlock}\n\nDecisions:\n${decisionBullets}\n\nActions:\n${actions}${openQuestionBlock}`,
    slack: `*Recap: ${meetingTitle}*\n${slackParticipantBlock}${slackOverviewBlock}${slackEntityContextBlock}${slackDiscussionBlock}\n\n*Decisions:*\n${decisionBullets}\n\n*Action Items:*\n${actions}${slackOpenQuestionBlock}`,
  };
};
