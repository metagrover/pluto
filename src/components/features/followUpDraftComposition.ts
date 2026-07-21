export type FollowUpFormat = 'email' | 'internal' | 'slack';

export type FollowUpVariants = Record<FollowUpFormat, string>;

export interface FollowUpEvidence {
  meetingTitle: string;
  overview: string[];
  decisions: string[];
  actionItems: string[];
  openQuestions: string[];
  discussionPoints: string[];
  topicSummaries: string[];
}

export interface FollowUpComposition {
  state: 'ready' | 'weak';
  reason: string;
  fingerprint: string;
  variants: FollowUpVariants;
}

export interface SavedFollowUpDocument {
  version: 2;
  fingerprint: string;
  variants: FollowUpVariants;
  edited: Record<FollowUpFormat, boolean>;
  activeFormat: FollowUpFormat;
}

export interface ParsedSavedFollowUpDocument {
  kind: 'empty' | 'legacy' | 'v2' | 'malformed';
  document: SavedFollowUpDocument | null;
}

const FORMATS: FollowUpFormat[] = ['email', 'internal', 'slack'];
const EMPTY_VARIANTS: FollowUpVariants = { email: '', internal: '', slack: '' };
const INTERNAL_DETAIL =
  /\s*\((?=[^)]*(?:Topic|Owner|Due|Status|Context|Decided by|Why):)[^)]*\)/gi;

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ');

const cleanEvidence = (value: string): string =>
  normalize(value.replace(INTERNAL_DETAIL, ''));

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values
    .map(cleanEvidence)
    .filter((value) => {
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
    .map((value, index) => ({ value, index, priority: lifecyclePriority(value) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ value }) => value)
    .map(cleanEvidence)
    .filter(Boolean)
    .slice(0, 3);

const bullets = (values: string[], marker = '-'): string =>
  values.map((value) => `${marker} ${value}`).join('\n');

const section = (heading: string, values: string[]): string =>
  values.length ? `\n\n${heading}\n${bullets(values)}` : '';

const normalizeEvidence = (evidence: FollowUpEvidence) => ({
  meetingTitle: normalize(evidence.meetingTitle),
  overview: unique(evidence.overview).slice(0, 2),
  decisions: unique(evidence.decisions).slice(0, 2),
  actionItems: selectActions(evidence.actionItems),
  openQuestions: unique(evidence.openQuestions).slice(0, 2),
  discussion: unique([...evidence.topicSummaries, ...evidence.discussionPoints]).slice(
    0,
    2,
  ),
});

export const createEvidenceFingerprint = (evidence: FollowUpEvidence): string => {
  const source = JSON.stringify(normalizeEvidence(evidence));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const composeFollowUp = (
  evidence: FollowUpEvidence,
): FollowUpComposition => {
  const normalized = normalizeEvidence(evidence);
  const fingerprint = createEvidenceFingerprint(evidence);
  const currentRead = unique([...normalized.overview, ...normalized.discussion]).slice(
    0,
    2,
  );
  const hasEvidence =
    currentRead.length > 0 ||
    normalized.decisions.length > 0 ||
    normalized.actionItems.length > 0 ||
    normalized.openQuestions.length > 0;

  if (!hasEvidence) {
    return {
      state: 'weak',
      reason:
        'Pluto does not have enough supported meeting context to prepare a useful follow-up yet.',
      fingerprint,
      variants: { ...EMPTY_VARIANTS },
    };
  }

  const title = normalized.meetingTitle || 'Meeting follow-up';
  const email = [
    `Subject: Follow-up: ${title}`,
    '',
    'Hi team,',
    currentRead.length ? `\n${currentRead.join(' ')}` : '',
    section('Decisions', normalized.decisions),
    section('Next steps', normalized.actionItems),
    section('Open questions', normalized.openQuestions),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const internal = [
    `${title} — follow-up`,
    currentRead.length ? `\n${currentRead.join(' ')}` : '',
    section('Decisions', normalized.decisions),
    section('Next steps', normalized.actionItems),
    section('Open questions', normalized.openQuestions),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const slackSections = [
    currentRead.length ? currentRead.join(' ') : '',
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
    state: 'ready',
    reason: '',
    fingerprint,
    variants: {
      email,
      internal,
      slack: `*${title}*\n\n${slackSections.join('\n\n')}`.trim(),
    },
  };
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  Boolean(value) &&
  typeof value === 'object' &&
  Object.values(value).every((entry) => typeof entry === 'string');

const isFormat = (value: unknown): value is FollowUpFormat =>
  typeof value === 'string' && FORMATS.includes(value as FollowUpFormat);

export const parseSavedFollowUpDocument = (
  value?: string,
): ParsedSavedFollowUpDocument => {
  if (!value) return { kind: 'empty', document: null };

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version === 2 &&
      typeof parsed.fingerprint === 'string' &&
      isStringRecord(parsed.variants) &&
      parsed.edited &&
      typeof parsed.edited === 'object'
    ) {
      const variants = parsed.variants;
      const edited = parsed.edited as Record<string, unknown>;
      return {
        kind: 'v2',
        document: {
          version: 2,
          fingerprint: parsed.fingerprint,
          variants: {
            email: variants.email || '',
            internal: variants.internal || '',
            slack: variants.slack || '',
          },
          edited: {
            email: edited.email === true,
            internal: edited.internal === true,
            slack: edited.slack === true,
          },
          activeFormat: isFormat(parsed.activeFormat)
            ? parsed.activeFormat
            : 'email',
        },
      };
    }

    if (isStringRecord(parsed)) {
      const variants = {
        email: parsed.client || parsed.email || '',
        internal: parsed.internal || '',
        slack: parsed.slack || '',
      };
      return {
        kind: 'legacy',
        document: {
          version: 2,
          fingerprint: 'legacy',
          variants,
          edited: {
            email: Boolean(variants.email),
            internal: Boolean(variants.internal),
            slack: Boolean(variants.slack),
          },
          activeFormat: 'email',
        },
      };
    }
  } catch {
    return { kind: 'malformed', document: null };
  }

  return { kind: 'malformed', document: null };
};

export const mergeSavedFollowUp = (
  saved: SavedFollowUpDocument | null,
  composition: FollowUpComposition,
): { document: SavedFollowUpDocument; contextChanged: boolean } => {
  if (!saved) {
    return {
      contextChanged: false,
      document: {
        version: 2,
        fingerprint: composition.fingerprint,
        variants: { ...composition.variants },
        edited: { email: false, internal: false, slack: false },
        activeFormat: 'email',
      },
    };
  }

  const contextChanged = saved.fingerprint !== composition.fingerprint;
  return {
    contextChanged,
    document: {
      ...saved,
      fingerprint: composition.fingerprint,
      variants: {
        email: saved.edited.email
          ? saved.variants.email
          : composition.variants.email,
        internal: saved.edited.internal
          ? saved.variants.internal
          : composition.variants.internal,
        slack: saved.edited.slack
          ? saved.variants.slack
          : composition.variants.slack,
      },
    },
  };
};

export const serializeSavedFollowUpDocument = (
  document: SavedFollowUpDocument,
): string => JSON.stringify(document);
