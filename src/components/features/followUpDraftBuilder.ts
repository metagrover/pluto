import type { Entity } from '../../api/knowledgeGraph';

const formatBulletBlock = (items: string[], fallback: string) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : fallback;

const normalizeKey = (value: string) => value.trim().toLowerCase();

const compareByMentionThenName = (
  a: Entity & { mention_count?: number },
  b: Entity & { mention_count?: number },
) => {
  const mentionDelta = (b.mention_count ?? 0) - (a.mention_count ?? 0);
  if (mentionDelta !== 0) return mentionDelta;
  return a.name.localeCompare(b.name);
};

const formatDueLabel = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const formatActionItem = (
  action: Entity,
  peopleById: Map<string, string>,
): string => {
  const details = [
    action.assigned_to
      ? `Owner: ${peopleById.get(action.assigned_to) ?? 'Unassigned'}`
      : '',
    formatDueLabel(action.due_date)
      ? `Due: ${formatDueLabel(action.due_date)}`
      : '',
  ].filter(Boolean);

  return details.length > 0
    ? `${action.name} (${details.join(' | ')})`
    : action.name;
};

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export interface FollowUpContextInput {
  meetingTitle: string;
  fallbackActionItems: string[];
  decisions: string[];
  meetingEntities: Array<
    Entity & { mention_count?: number; context?: string | null }
  >;
}

export interface FollowUpContext {
  meetingTitle: string;
  participants: string[];
  actionItems: string[];
  decisions: string[];
}

export interface DefaultDraftsInput {
  meetingTitle: string;
  participants: string[];
  actionItems: string[];
  decisions: string[];
}

export type DraftId = 'client' | 'internal' | 'slack';
export type Drafts = Partial<Record<DraftId, string>>;

export const buildFollowUpContext = ({
  meetingTitle,
  fallbackActionItems,
  decisions,
  meetingEntities,
}: FollowUpContextInput): FollowUpContext => {
  const people = meetingEntities
    .filter((entity) => entity.type === 'person')
    .sort(compareByMentionThenName);
  const peopleById = new Map(people.map((person) => [person.id, person.name]));
  const participants = unique(people.map((person) => person.name));

  const linkedActionItems = meetingEntities
    .filter((entity) => entity.type === 'action_item')
    .sort(compareByMentionThenName)
    .map((action) => ({
      normalizedName: normalizeKey(action.name),
      formatted: formatActionItem(action, peopleById),
    }));

  const linkedActionItemsByName = new Map(
    linkedActionItems.map((action) => [
      action.normalizedName,
      action.formatted,
    ]),
  );

  const fallbackItems = fallbackActionItems.map((item) => {
    const linked = linkedActionItemsByName.get(normalizeKey(item));
    return linked ?? item;
  });
  const fallbackNames = new Set(fallbackActionItems.map(normalizeKey));
  const linkedOnlyItems = linkedActionItems
    .filter((action) => !fallbackNames.has(action.normalizedName))
    .map((action) => action.formatted);

  const actionItems = unique(
    [...fallbackItems, ...linkedOnlyItems].filter((item) => normalizeKey(item)),
  );

  return {
    meetingTitle,
    participants,
    actionItems: actionItems.length > 0 ? actionItems : fallbackActionItems,
    decisions,
  };
};

export const buildDefaultDrafts = ({
  meetingTitle,
  participants,
  actionItems,
  decisions,
}: DefaultDraftsInput): Drafts => {
  const participantLine =
    participants.length > 0
      ? `Participants: ${participants.join(', ')}\n\n`
      : '';
  const slackParticipants =
    participants.length > 0
      ? `*Participants:* ${participants.join(', ')}\n\n`
      : '';
  const actions = formatBulletBlock(actionItems, '- None');
  const decisionBullets = formatBulletBlock(decisions, '- None');

  return {
    client: `Subject: Recap: ${meetingTitle}\n\nHi Team,\n\n${participantLine}Decisions:\n${decisionBullets}\n\nNext Steps:\n${actions}`,
    internal: `Team, session on ${meetingTitle}:\n\n${participantLine}Decisions:\n${decisionBullets}\n\nActions:\n${actions}`,
    slack: `*Recap: ${meetingTitle}*\n\n${slackParticipants}*Decisions:*\n${decisionBullets}\n\n*Action Items:*\n${actions}`,
  };
};
