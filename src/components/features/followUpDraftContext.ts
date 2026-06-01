import type { Entity } from '../../api/knowledgeGraph';
import type { TopicSection } from '../../types';

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

export interface DefaultDraftsInput {
  meetingTitle: string;
  actionItems: string[];
  decisions: string[];
  discussionPoints?: string[];
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

const toBullets = (items: string[], fallback: string) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : fallback;

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
  actionItems,
  decisions,
  discussionPoints = [],
  participants,
}: DefaultDraftsInput): Drafts => {
  const actions = toBullets(actionItems, '- None');
  const decisionBullets = toBullets(decisions, '- None');
  const discussionBlock = discussionPoints.length
    ? `\n\nDiscussion Context:\n${toBullets(discussionPoints, '- None')}`
    : '';
  const participantLine = participants.length
    ? `\nParticipants: ${participants.join(', ')}`
    : '';
  const slackParticipantBlock = participants.length
    ? `\n*Participants:* ${participants.join(', ')}\n`
    : '\n';
  const slackDiscussionBlock = discussionPoints.length
    ? `\n*Discussion Context:*\n${toBullets(discussionPoints, '- None')}\n`
    : '';

  return {
    client: `Subject: Recap: ${meetingTitle}\n\nHi Team,\n\nMeeting: ${meetingTitle}${participantLine}${discussionBlock}\n\nDecisions:\n${decisionBullets}\n\nNext Steps:\n${actions}`,
    internal: `Team, session on ${meetingTitle}:${participantLine}${discussionBlock}\n\nDecisions:\n${decisionBullets}\n\nActions:\n${actions}`,
    slack: `*Recap: ${meetingTitle}*\n${slackParticipantBlock}${slackDiscussionBlock}\n*Decisions:*\n${decisionBullets}\n\n*Action Items:*\n${actions}`,
  };
};
