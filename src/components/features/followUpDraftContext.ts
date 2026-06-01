import { type Entity, parseMetadata } from '../../api/knowledgeGraph';
import type { AnalysisDocumentV3, TopicSection } from '../../types';
import type { MeetingLinkedAttentionItem } from './meetingActionItems';

type MeetingEntitySummary = Entity & {
  mention_count: number;
  context: string | null;
};

interface FollowUpDraftContextInput {
  fallbackActionItems: string[];
  linkedEntities: MeetingEntitySummary[];
  linkedAttentionItems?: MeetingLinkedAttentionItem[];
}

interface FollowUpDraftActionItemInput {
  text: string;
  topic?: string;
  assignee?: string;
  due?: string;
}

export interface FollowUpDraftContext {
  actionItems: string[];
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
  value.replace(/\s+\((?:Topic|Owner|Due): .*$/i, '').trim();

const normalizeKey = (value: string | null | undefined): string =>
  stripKnownActionItemDetails(normalizeName(value)).toLowerCase();

const compareEntities = (a: MeetingEntitySummary, b: MeetingEntitySummary) => {
  if (b.mention_count !== a.mention_count) {
    return b.mention_count - a.mention_count;
  }
  return a.name.localeCompare(b.name);
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

const formatActionItem = (
  entity: MeetingEntitySummary,
  peopleById: Map<string, string>,
): string => {
  const ownerId = normalizeName(entity.assigned_to);
  const ownerName = ownerId ? (peopleById.get(ownerId) ?? ownerId) : '';
  const dueLabel = formatDueLabel(entity.due_date);
  const lifecycleLabel = formatLifecycleLabel(entity.status);
  const details = [
    lifecycleLabel ? `Status: ${lifecycleLabel}` : '',
    ownerName ? `Owner: ${ownerName}` : '',
    dueLabel ? `Due: ${dueLabel}` : '',
  ].filter(Boolean);

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

const formatTopicAwareDecision = (text: string, topicTitle: string): string =>
  topicTitle ? `${text} (Topic: ${topicTitle})` : text;

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
  linkedEntities,
  linkedAttentionItems = [],
}: FollowUpDraftContextInput): FollowUpDraftContext => {
  const people = linkedEntities
    .filter((entity) => entity.type === 'person')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const peopleById = new Map(people.map((entity) => [entity.id, entity.name]));
  const suppressedEntityIds = new Set(
    linkedAttentionItems
      .filter(
        (item) => item.status === 'dismissed' || item.status === 'snoozed',
      )
      .flatMap((item) => item.related_entity_ids),
  );

  const allLinkedActionEntities = linkedEntities
    .filter((entity) => entity.type === 'action_item')
    .filter((entity) => normalizeName(entity.name));
  const actionEntities = allLinkedActionEntities
    .filter((entity) => entity.status !== 'completed')
    .filter((entity) => !suppressedEntityIds.has(entity.id))
    .sort(compareEntities);
  const linkedActionNames = new Set(
    allLinkedActionEntities.map((entity) => normalizeKey(entity.name)),
  );
  const actionItems = actionEntities.map((entity) =>
    formatActionItem(entity, peopleById),
  );
  const fallbackOnlyItems = fallbackActionItems.filter(
    (item) => !linkedActionNames.has(normalizeKey(item)),
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
        ? [...actionItems, ...fallbackOnlyItems]
        : fallbackActionItems,
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
      decisions.push(formatTopicAwareDecision(text, topicTitle));
    }
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
