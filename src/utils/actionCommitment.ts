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

export const isThirdPartyAssignee = (
  assignee?: string | null,
  text?: string | null,
): boolean => {
  if (assignee && typeof assignee === 'string') {
    const trimmed = assignee.trim().toLowerCase();
    if (trimmed === 'them' || /^remote\s+speaker/i.test(trimmed)) return true;
  }
  if (text && typeof text === 'string') {
    const trimmed = text.trim().toLowerCase();
    if (
      /^(?:them|they|remote\s+speaker(?:\s+\d+)?)\s+(?:will|to|shall|must|should|needs?\s+to|is\s+to|are\s+to|has\s+to|have\s+to)\b/i.test(
        trimmed,
      )
    ) {
      return true;
    }
  }
  return false;
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
