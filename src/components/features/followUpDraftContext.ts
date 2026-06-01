import type { Entity } from '../../api/knowledgeGraph';
import type { AnalysisDocumentV3 } from '../../types';

type MeetingEntitySummary = Entity & {
  mention_count: number;
  context: string | null;
};

interface FollowUpDraftContextInput {
  fallbackActionItems: string[];
  linkedEntities: MeetingEntitySummary[];
}

export interface FollowUpDraftContext {
  actionItems: string[];
  participants: string[];
}

interface FollowUpDraftDecisionsInput {
  fallbackDecisions: string[];
  analysis?: AnalysisDocumentV3 | null;
}

export interface DefaultDraftsInput {
  meetingTitle: string;
  actionItems: string[];
  decisions: string[];
  participants: string[];
}

export type DraftId = 'client' | 'internal' | 'slack';
export type Drafts = Partial<Record<DraftId, string>>;

const normalizeName = (value: string | null | undefined): string =>
  (value || '').trim();

const normalizeKey = (value: string | null | undefined): string =>
  normalizeName(value).toLowerCase();

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

const formatActionItem = (
  entity: MeetingEntitySummary,
  peopleById: Map<string, string>,
): string => {
  const ownerId = normalizeName(entity.assigned_to);
  const ownerName = ownerId ? (peopleById.get(ownerId) ?? ownerId) : '';
  const dueLabel = formatDueLabel(entity.due_date);
  const details = [
    ownerName ? `Owner: ${ownerName}` : '',
    dueLabel ? `Due: ${dueLabel}` : '',
  ].filter(Boolean);

  return details.length > 0
    ? `${entity.name} (${details.join(' | ')})`
    : entity.name;
};

const formatTopicAwareDecision = (text: string, topicTitle: string): string =>
  topicTitle ? `${text} (Topic: ${topicTitle})` : text;

export const buildFollowUpDraftContext = ({
  fallbackActionItems,
  linkedEntities,
}: FollowUpDraftContextInput): FollowUpDraftContext => {
  const people = linkedEntities
    .filter((entity) => entity.type === 'person')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const peopleById = new Map(people.map((entity) => [entity.id, entity.name]));

  const actionEntities = linkedEntities
    .filter((entity) => entity.type === 'action_item')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const linkedActionNames = new Set(
    actionEntities.map((entity) => normalizeKey(entity.name)),
  );
  const actionItems = actionEntities.map((entity) =>
    formatActionItem(entity, peopleById),
  );
  const fallbackOnlyItems = fallbackActionItems.filter(
    (item) => !linkedActionNames.has(normalizeKey(item)),
  );

  return {
    actionItems:
      actionItems.length > 0
        ? [...actionItems, ...fallbackOnlyItems]
        : fallbackActionItems,
    participants: people.map((entity) => entity.name),
  };
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

const toBullets = (items: string[], fallback: string) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : fallback;

export const buildDefaultDrafts = ({
  meetingTitle,
  actionItems,
  decisions,
  participants,
}: DefaultDraftsInput): Drafts => {
  const actions = toBullets(actionItems, '- None');
  const decisionBullets = toBullets(decisions, '- None');
  const participantLine = participants.length
    ? `\nParticipants: ${participants.join(', ')}`
    : '';
  const slackParticipantBlock = participants.length
    ? `\n*Participants:* ${participants.join(', ')}\n`
    : '\n';

  return {
    client: `Subject: Recap: ${meetingTitle}\n\nHi Team,\n\nMeeting: ${meetingTitle}${participantLine}\n\nDecisions:\n${decisionBullets}\n\nNext Steps:\n${actions}`,
    internal: `Team, session on ${meetingTitle}:${participantLine}\n\nDecisions:\n${decisionBullets}\n\nActions:\n${actions}`,
    slack: `*Recap: ${meetingTitle}*\n${slackParticipantBlock}\n*Decisions:*\n${decisionBullets}\n\n*Action Items:*\n${actions}`,
  };
};
