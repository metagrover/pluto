export type CommitmentState = 'possible' | 'confirmed' | 'rejected';

export type ActionOrigin = 'extraction' | 'user';

export interface ActionCommitmentMetadata extends Record<string, unknown> {
  commitment_state: CommitmentState;
  origin: ActionOrigin;
  source_meeting_id?: string;
  reviewed_at?: string;
  full_description?: string;
  assignee_name?: string;
}

export const parseActionMetadata = (
  value: string | null,
): Record<string, unknown> => {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const getCommitmentState = (value: string | null): CommitmentState => {
  const state = parseActionMetadata(value).commitment_state;
  return state === 'confirmed' || state === 'rejected' ? state : 'possible';
};

export const mergeCommitmentReview = (
  value: string | null,
  commitmentState: 'confirmed' | 'rejected',
  reviewedAt: string,
): Record<string, unknown> => ({
  ...parseActionMetadata(value),
  commitment_state: commitmentState,
  reviewed_at: reviewedAt,
});

export const GENERIC_ACTION_ASSIGNEE =
  /^(?:(?:and|so|then)\s+)?(?:group|team|the team|we|everyone|i|me|you|them)$/i;

export const SELF_ACTION_ASSIGNEES = new Set([
  'me',
  'i',
  'you',
  'myself',
  '(you)',
  'user',
  'self',
]);

export const COLLECTIVE_ACTION_ASSIGNEES = new Set([
  'we',
  'team',
  'the team',
  'everyone',
  'group',
  'all',
]);

export interface ThirdPartyAssigneeOptions {
  selfNames?: string[];
  selfPersonId?: string | null;
}

export const isThirdPartyAssignee = (
  assignee?: string | null,
  text?: string | null,
  options?: ThirdPartyAssigneeOptions,
): boolean => {
  const selfNamesSet = new Set(
    (options?.selfNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  if (assignee && typeof assignee === 'string') {
    const trimmed = assignee.trim().toLowerCase();
    if (trimmed) {
      if (
        SELF_ACTION_ASSIGNEES.has(trimmed) ||
        COLLECTIVE_ACTION_ASSIGNEES.has(trimmed) ||
        selfNamesSet.has(trimmed)
      ) {
        return false;
      }
      return true;
    }
  }

  if (text && typeof text === 'string') {
    const trimmed = text.trim();
    if (
      /^(?:them|they|he|she|remote\s+speaker(?:\s+\d+)?|speaker\s+\d+)\s+(?:will|to|shall|must|should|needs?\s+to|is\s+to|are\s+to|has\s+to|have\s+to)\b/i.test(
        trimmed,
      )
    ) {
      return true;
    }

    const modalMatch = trimmed.match(
      /^([A-Za-z0-9_'-]+)\s+(?:will|shall|must|should|needs?\s+to|is\s+to|has\s+to)\b/i,
    );
    if (modalMatch) {
      const subject = modalMatch[1].toLowerCase();
      if (
        !SELF_ACTION_ASSIGNEES.has(subject) &&
        !COLLECTIVE_ACTION_ASSIGNEES.has(subject) &&
        !selfNamesSet.has(subject)
      ) {
        return true;
      }
    }
  }
  return false;
};

export const isThirdPartyAction = (
  action: {
    assigned_to?: string | null;
    metadata?: string | null;
    name?: string;
  },
  options?: ThirdPartyAssigneeOptions,
): boolean => {
  if (action.assigned_to) {
    if (options?.selfPersonId) {
      return action.assigned_to !== options.selfPersonId;
    }
    return true;
  }

  const metadata = parseActionMetadata(action.metadata ?? null);
  const assigneeName =
    typeof metadata.assignee_name === 'string' ? metadata.assignee_name : null;
  const description =
    typeof metadata.full_description === 'string'
      ? metadata.full_description
      : action.name;

  return isThirdPartyAssignee(
    assigneeName,
    description || action.name,
    options,
  );
};

export const capitalizeActionText = (value: string): string =>
  value.replace(/^\p{Ll}/u, (character) =>
    character.toLocaleUpperCase('en-US'),
  );

export const canonicalizeActionText = (
  text: string,
  assignee?: string,
): string => {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  const subjectPatterns = [
    '(?:the\\s+team|team|we|i|me|them|you|they|he|she)',
    ...(assignee && !GENERIC_ACTION_ASSIGNEE.test(assignee.trim())
      ? [assignee.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]
      : []),
  ];
  const subjects = subjectPatterns.join('|');

  const modalFraming = new RegExp(
    `^(?:${subjects})\\s+(?:will|shall|can|must|should|needs?\\s+to|is\\s+to|are\\s+to|has\\s+to|have\\s+to|(?:is|are|am)\\s+going\\s+to|(?:has|have)\\s+(?:agreed|committed)\\s+to)\\s+`,
    'i',
  );
  const infinitiveFraming = new RegExp(`^(?:${subjects})\\s+to\\s+`, 'i');

  let canonical = trimmed
    .replace(/^(?:i|we|they|you|he|she)['’]ll\s+/i, '')
    .replace(/^(?:please|kindly)\s+/i, '')
    .replace(modalFraming, '')
    .replace(infinitiveFraming, '')
    .trim();

  // Strip trailing punctuation often left by speech transcripts
  canonical = canonical.replace(/[.,;:]+$/, '').trim();

  return capitalizeActionText(canonical || trimmed);
};

export const normalizeActionText = (value: string, assignee?: string): string =>
  canonicalizeActionText(value, assignee)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const extractSignificantWords = (text: string): string[] => {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'if',
    'then',
    'so',
    'to',
    'for',
    'with',
    'at',
    'by',
    'from',
    'in',
    'on',
    'of',
    'about',
    'as',
    'into',
    'like',
    'through',
    'after',
    'over',
    'between',
    'out',
    'against',
    'during',
    'without',
    'before',
    'under',
    'around',
    'among',
    'is',
    'am',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'shall',
    'should',
    'can',
    'could',
    'may',
    'might',
    'must',
    'it',
    'its',
    'this',
    'that',
    'these',
    'those',
    'his',
    'her',
    'their',
    'our',
    'my',
    'your',
    'we',
    'me',
    'us',
    'them',
    'him',
    'up',
    'down',
  ]);
  return normalizeActionText(text)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
};

export interface ActionLikeObject {
  title?: string | null;
  name?: string | null;
  assigneeName?: string | null;
  sourceMeetingId?: string | null;
  metadata?: string | Record<string, unknown> | null;
}

export type ActionLike = string | ActionLikeObject;

const extractActionFields = (
  action: ActionLike,
): {
  title: string;
  assigneeName?: string | null;
  sourceMeetingId?: string | null;
} => {
  if (typeof action === 'string') {
    return { title: action };
  }
  const metadata =
    typeof action.metadata === 'string'
      ? parseActionMetadata(action.metadata)
      : ((action.metadata as Record<string, unknown> | null) ?? {});

  const title =
    action.title ??
    action.name ??
    (typeof metadata.full_description === 'string'
      ? metadata.full_description
      : '');
  const assigneeName =
    action.assigneeName ??
    (typeof metadata.assignee_name === 'string'
      ? metadata.assignee_name
      : null);
  const sourceMeetingId =
    action.sourceMeetingId ??
    (typeof metadata.source_meeting_id === 'string'
      ? metadata.source_meeting_id
      : null);

  return { title, assigneeName, sourceMeetingId };
};

export const areActionsEquivalent = (
  left: ActionLike,
  right: ActionLike,
): boolean => {
  const leftFields = extractActionFields(left);
  const rightFields = extractActionFields(right);

  // If both have non-generic assignees that differ, they are distinct
  if (
    leftFields.assigneeName &&
    rightFields.assigneeName &&
    !GENERIC_ACTION_ASSIGNEE.test(leftFields.assigneeName.trim()) &&
    !GENERIC_ACTION_ASSIGNEE.test(rightFields.assigneeName.trim()) &&
    leftFields.assigneeName.trim().toLowerCase() !==
      rightFields.assigneeName.trim().toLowerCase()
  ) {
    return false;
  }

  const normLeft = normalizeActionText(
    leftFields.title,
    leftFields.assigneeName ?? undefined,
  );
  const normRight = normalizeActionText(
    rightFields.title,
    rightFields.assigneeName ?? undefined,
  );
  if (!normLeft || !normRight) return false;
  if (normLeft === normRight) return true;

  const [shorter, longer] =
    normLeft.length < normRight.length
      ? [normLeft, normRight]
      : [normRight, normLeft];
  if (shorter.length >= 35 && longer.startsWith(shorter)) return true;

  if (
    leftFields.sourceMeetingId &&
    rightFields.sourceMeetingId &&
    leftFields.sourceMeetingId === rightFields.sourceMeetingId
  ) {
    const leftWords = extractSignificantWords(leftFields.title);
    const rightWords = extractSignificantWords(rightFields.title);
    if (leftWords.length > 0 && rightWords.length > 0) {
      const common = leftWords.filter((word) => rightWords.includes(word));
      const overlap =
        (2 * common.length) / (leftWords.length + rightWords.length);
      if (overlap >= 0.65) return true;
    }
  }

  return false;
};
