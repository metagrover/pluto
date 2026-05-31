import type { Entity } from '../../api/knowledgeGraph';

type MeetingEntitySummary = Entity & {
  mention_count: number;
  context: string | null;
};

interface FollowUpDraftContextInput {
  fallbackActionItems: string[];
  fallbackDecisions: string[];
  linkedEntities: MeetingEntitySummary[];
}

export interface FollowUpDraftContext {
  actionItems: string[];
  decisions: string[];
  participants: string[];
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

const parseEntityMetadata = (value: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const formatDecisionItem = (entity: MeetingEntitySummary): string => {
  const metadata = parseEntityMetadata(entity.metadata);
  const metadataRationale =
    typeof metadata.rationale === 'string' ? normalizeName(metadata.rationale) : '';
  const contextRationale = normalizeName(entity.context);
  const rationaleCandidates = [metadataRationale, contextRationale].filter(
    Boolean,
  );
  const rationale = rationaleCandidates.find(
    (candidate) => normalizeKey(candidate) !== normalizeKey(entity.name),
  );

  return rationale ? `${entity.name} (Why: ${rationale})` : entity.name;
};

export const buildFollowUpDraftContext = ({
  fallbackActionItems,
  fallbackDecisions,
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
  const decisionEntities = linkedEntities
    .filter((entity) => entity.type === 'decision')
    .filter((entity) => normalizeName(entity.name))
    .sort(compareEntities);
  const linkedDecisionNames = new Set(
    decisionEntities.map((entity) => normalizeKey(entity.name)),
  );
  const fallbackOnlyDecisions = fallbackDecisions.filter(
    (item) => !linkedDecisionNames.has(normalizeKey(item)),
  );

  return {
    actionItems:
      actionItems.length > 0
        ? [...actionItems, ...fallbackOnlyItems]
        : fallbackActionItems,
    decisions:
      decisionEntities.length > 0
        ? [
            ...decisionEntities.map((entity) => formatDecisionItem(entity)),
            ...fallbackOnlyDecisions,
          ]
        : fallbackDecisions,
    participants: people.map((entity) => entity.name),
  };
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
