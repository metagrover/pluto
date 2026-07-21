export type FollowUpFormat = 'email' | 'internal' | 'slack';
export type FollowUpVariants = Record<FollowUpFormat, string>;

export interface FollowUpCompositionInput {
  meetingTitle: string;
  overview: string[];
  actionItems: string[];
  decisions: string[];
  entityContext?: string[];
  discussionPoints: string[];
  participants?: string[];
  openQuestions: string[];
  topicSummaries: string[];
}

export interface FollowUpComposition {
  availability: 'ready' | 'weak_evidence';
  reason: string;
  evidenceFingerprint: string;
  variants: FollowUpVariants;
}

export interface SavedFollowUpDraftsV2 {
  schemaVersion: 2;
  selectedFormat: FollowUpFormat;
  evidenceFingerprint: string;
  variants: FollowUpVariants;
  editedFormats: FollowUpFormat[];
}

const FORMATS: FollowUpFormat[] = ['email', 'internal', 'slack'];
const EMPTY_VARIANTS: FollowUpVariants = { email: '', internal: '', slack: '' };

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ');

const cleanSendableText = (value: string): string =>
  normalize(
    value.replace(
      /\s*\((?=[^)]*(?:Project|Topic|Linked Context|Status|Context|Why|Decided by|Owner|Due):)[^)]*\)/gi,
      '',
    ),
  );

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.map(cleanSendableText).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const lifecyclePriority = (value: string): number => {
  if (/\bblocked|blocker\b/i.test(value)) return 0;
  if (/\boverdue\b/i.test(value)) return 1;
  if (/\bactive\b/i.test(value)) return 2;
  return 3;
};

const selectActions = (values: string[]): string[] =>
  values
    .map((value, index) => ({
      value,
      index,
      priority: lifecyclePriority(value),
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority || left.index - right.index,
    )
    .map(({ value }) => cleanSendableText(value))
    .filter(Boolean)
    .slice(0, 5);

const normalizeInput = (input: FollowUpCompositionInput) => ({
  meetingTitle: normalize(input.meetingTitle),
  overview: unique(input.overview).slice(0, 1),
  decisions: unique(input.decisions).slice(0, 3),
  actionItems: selectActions(input.actionItems),
  openQuestions: unique(input.openQuestions).slice(0, 3),
  discussion: unique([
    ...input.topicSummaries,
    ...input.discussionPoints,
  ]).slice(0, 2),
});

const fingerprint = (value: unknown): string => {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const bullets = (values: string[], marker = '-'): string =>
  values.map((value) => `${marker} ${value}`).join('\n');

const section = (heading: string, values: string[]): string =>
  values.length ? `\n\n${heading}\n${bullets(values)}` : '';

export const composeFollowUp = (
  input: FollowUpCompositionInput,
): FollowUpComposition => {
  const normalized = normalizeInput(input);
  const evidenceFingerprint = fingerprint(normalized);
  const currentRead = normalized.overview.length
    ? normalized.overview
    : normalized.discussion;
  const hasEvidence =
    currentRead.length > 0 ||
    normalized.decisions.length > 0 ||
    normalized.actionItems.length > 0 ||
    normalized.openQuestions.length > 0;

  if (!hasEvidence) {
    return {
      availability: 'weak_evidence',
      reason:
        'Pluto does not yet have enough meeting evidence to draft a useful follow-up.',
      evidenceFingerprint,
      variants: { ...EMPTY_VARIANTS },
    };
  }

  const title = normalized.meetingTitle || 'Meeting follow-up';
  const read = currentRead.join(' ');
  const email = [
    `Subject: Follow-up: ${title}`,
    '',
    'Hi team,',
    read ? `\n${read}` : '',
    section('Decisions', normalized.decisions),
    section('Next steps', normalized.actionItems),
    section('Open questions', normalized.openQuestions),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const internal = [
    `${title} — follow-up`,
    read ? `\n${read}` : '',
    section('Decisions', normalized.decisions),
    section('Next steps', normalized.actionItems),
    section('Open questions', normalized.openQuestions),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const slackSections = [
    read,
    normalized.decisions.length
      ? `*Decisions*\n${bullets(normalized.decisions, '•')}`
      : '',
    normalized.actionItems.length
      ? `*Next steps*\n${bullets(normalized.actionItems, '•')}`
      : '',
    normalized.openQuestions.length
      ? `*Open questions*\n${bullets(normalized.openQuestions, '•')}`
      : '',
  ].filter(Boolean);

  return {
    availability: 'ready',
    reason: '',
    evidenceFingerprint,
    variants: {
      email,
      internal,
      slack: `*${title}*\n\n${slackSections.join('\n\n')}`.trim(),
    },
  };
};

export const createSavedFollowUpDrafts = (
  composition: FollowUpComposition,
): SavedFollowUpDraftsV2 => ({
  schemaVersion: 2,
  selectedFormat: 'email',
  evidenceFingerprint: composition.evidenceFingerprint,
  variants: { ...composition.variants },
  editedFormats: [],
});

const isFormat = (value: unknown): value is FollowUpFormat =>
  typeof value === 'string' && FORMATS.includes(value as FollowUpFormat);

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export const parseSavedFollowUpDrafts = (
  value: string | undefined,
  composition: FollowUpComposition,
): SavedFollowUpDraftsV2 | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.schemaVersion === 2 &&
      parsed.variants &&
      typeof parsed.variants === 'object' &&
      Array.isArray(parsed.editedFormats)
    ) {
      const variants = parsed.variants as Record<string, unknown>;
      const editedFormats = parsed.editedFormats.filter(isFormat);
      const saved: SavedFollowUpDraftsV2 = {
        schemaVersion: 2,
        selectedFormat: isFormat(parsed.selectedFormat)
          ? parsed.selectedFormat
          : 'email',
        evidenceFingerprint: stringValue(parsed.evidenceFingerprint),
        variants: {
          email: stringValue(variants.email),
          internal: stringValue(variants.internal),
          slack: stringValue(variants.slack),
        },
        editedFormats,
      };
      if (
        saved.evidenceFingerprint !== composition.evidenceFingerprint &&
        editedFormats.length === 0
      ) {
        return {
          ...createSavedFollowUpDrafts(composition),
          selectedFormat: saved.selectedFormat,
        };
      }
      return saved;
    }

    const legacy = {
      email: stringValue(parsed.client || parsed.email),
      internal: stringValue(parsed.internal),
      slack: stringValue(parsed.slack),
    };
    if (Object.values(legacy).some(Boolean)) {
      return {
        schemaVersion: 2,
        selectedFormat: 'email',
        evidenceFingerprint: 'legacy',
        variants: legacy,
        editedFormats: FORMATS.filter((format) => Boolean(legacy[format])),
      };
    }
  } catch (error) {
    console.error('Failed to parse saved follow-up drafts:', error);
  }
  return null;
};

export const mergeRefinedVariants = (
  saved: SavedFollowUpDraftsV2,
  refined: FollowUpVariants,
): SavedFollowUpDraftsV2 => ({
  ...saved,
  variants: {
    email: saved.editedFormats.includes('email')
      ? saved.variants.email
      : refined.email,
    internal: saved.editedFormats.includes('internal')
      ? saved.variants.internal
      : refined.internal,
    slack: saved.editedFormats.includes('slack')
      ? saved.variants.slack
      : refined.slack,
  },
});
