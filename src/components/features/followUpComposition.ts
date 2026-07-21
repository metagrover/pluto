export type FollowUpFormat = 'email' | 'internal' | 'slack';

export interface FollowUpCompositionInput {
  meetingTitle: string;
  overview: string[];
  actionItems: string[];
  decisions: string[];
  discussionPoints: string[];
  openQuestions: string[];
  topicSummaries: string[];
  participants?: string[];
  entityContext?: string[];
}

export type FollowUpVariants = Record<FollowUpFormat, string>;

export type FollowUpComposition =
  | {
      availability: 'ready';
      recommendedFormat: FollowUpFormat;
      variants: FollowUpVariants;
      evidenceFingerprint: string;
    }
  | {
      availability: 'weak_evidence';
      reason: string;
      evidenceFingerprint: string;
    };

export interface SavedFollowUpDraftsV2 {
  schemaVersion: 2;
  selectedFormat: FollowUpFormat;
  evidenceFingerprint: string;
  variants: FollowUpVariants;
  editedFormats: FollowUpFormat[];
}

export type ParsedSavedFollowUpDrafts = {
  state: 'none' | 'valid' | 'legacy' | 'invalid';
  document: SavedFollowUpDraftsV2 | null;
};

export const getSaveCompletionState = (
  completedRevision: number,
  currentRevision: number,
  succeeded: boolean,
  lastSavedRevision = -1,
): 'saving' | 'saved' | 'error' => {
  if (lastSavedRevision >= currentRevision) return 'saved';
  if (completedRevision !== currentRevision) return 'saving';
  return succeeded ? 'saved' : 'error';
};

const FORMATS: FollowUpFormat[] = ['email', 'internal', 'slack'];
const INTERNAL_LABEL =
  /(?:^|\|)\s*(?:Project|Topic|Linked Context|Status|Context|Why|Decided by|Owner|Due):/i;

const stripTrailingInternalDetails = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.endsWith(')')) return trimmed;
  let depth = 0;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] === ')') depth += 1;
    if (trimmed[index] !== '(') continue;
    depth -= 1;
    if (depth !== 0) continue;
    const details = trimmed.slice(index + 1, -1);
    return INTERNAL_LABEL.test(details)
      ? trimmed.slice(0, index).trim()
      : trimmed;
  }
  return trimmed;
};

const normalizeLine = (value: string): string =>
  stripTrailingInternalDetails(value.replace(/\s+/g, ' '));

const normalizedLines = (values: string[], limit: number): string[] =>
  values.map(normalizeLine).filter(Boolean).slice(0, limit);

const bullets = (values: string[], markdown = false): string =>
  values.map((value) => `${markdown ? '-' : '•'} ${value}`).join('\n');

const section = (title: string, values: string[], markdown = false): string => {
  if (values.length === 0) return '';
  return `${markdown ? `*${title}:*` : `${title}:`}\n${bullets(values, markdown)}`;
};

const hashEvidence = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fup-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const buildFollowUpComposition = (
  input: FollowUpCompositionInput,
): FollowUpComposition => {
  const overview = normalizedLines(input.overview, 1);
  const decisions = normalizedLines(input.decisions, 3);
  const actions = normalizedLines(input.actionItems, 5);
  const questions = normalizedLines(input.openQuestions, 3);
  const topicSummaries = normalizedLines(input.topicSummaries, 1);
  const discussion = normalizedLines(input.discussionPoints, 1);
  const currentRead = overview[0] || topicSummaries[0] || discussion[0] || '';
  const evidenceFingerprint = hashEvidence(
    JSON.stringify({
      meetingTitle: normalizeLine(input.meetingTitle),
      currentRead,
      decisions,
      actions,
      questions,
    }),
  );

  if (
    !currentRead &&
    !decisions.length &&
    !actions.length &&
    !questions.length
  ) {
    return {
      availability: 'weak_evidence',
      reason:
        'Pluto does not yet have enough meeting evidence to draft a useful follow-up.',
      evidenceFingerprint,
    };
  }

  const emailSections = [
    currentRead,
    section('Decisions', decisions),
    section('Next steps', actions),
    section('Open questions', questions),
  ].filter(Boolean);
  const internalSections = [
    currentRead,
    section('Decisions', decisions),
    section('Next steps', actions),
    section('Open questions', questions),
  ].filter(Boolean);
  const slackSections = [
    currentRead,
    section('Decisions', decisions, true),
    section('Next steps', actions, true),
    section('Open questions', questions, true),
  ].filter(Boolean);

  return {
    availability: 'ready',
    recommendedFormat: 'email',
    evidenceFingerprint,
    variants: {
      email: `Subject: Follow-up: ${normalizeLine(input.meetingTitle)}\n\nHi team,\n\n${emailSections.join('\n\n')}`,
      internal: internalSections.join('\n\n'),
      slack: slackSections.join('\n\n'),
    },
  };
};

export const createSavedFollowUpDrafts = (
  selectedFormat: FollowUpFormat,
  evidenceFingerprint: string,
  variants: FollowUpVariants,
  editedFormats: FollowUpFormat[],
): SavedFollowUpDraftsV2 => ({
  schemaVersion: 2,
  selectedFormat,
  evidenceFingerprint,
  variants: { ...variants },
  editedFormats: FORMATS.filter((format) => editedFormats.includes(format)),
});

const isVariants = (value: unknown): value is FollowUpVariants => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return FORMATS.every((format) => typeof record[format] === 'string');
};

export const parseSavedFollowUpDrafts = (
  value: string | undefined,
  fallbackFingerprint: string,
): ParsedSavedFollowUpDrafts => {
  if (!value) return { state: 'none', document: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.schemaVersion === 2 &&
      FORMATS.includes(parsed.selectedFormat as FollowUpFormat) &&
      typeof parsed.evidenceFingerprint === 'string' &&
      isVariants(parsed.variants) &&
      Array.isArray(parsed.editedFormats)
    ) {
      return {
        state: 'valid',
        document: createSavedFollowUpDrafts(
          parsed.selectedFormat as FollowUpFormat,
          parsed.evidenceFingerprint,
          parsed.variants,
          parsed.editedFormats.filter((format): format is FollowUpFormat =>
            FORMATS.includes(format as FollowUpFormat),
          ),
        ),
      };
    }

    if (
      typeof parsed.client === 'string' &&
      typeof parsed.internal === 'string' &&
      typeof parsed.slack === 'string'
    ) {
      return {
        state: 'legacy',
        document: createSavedFollowUpDrafts(
          'email',
          fallbackFingerprint,
          {
            email: parsed.client,
            internal: parsed.internal,
            slack: parsed.slack,
          },
          FORMATS,
        ),
      };
    }
  } catch (error) {
    console.error('Failed to parse saved follow-up drafts:', error);
  }
  return { state: 'invalid', document: null };
};

export const resolveFollowUpDrafts = (
  composition: Extract<FollowUpComposition, { availability: 'ready' }>,
  saved: SavedFollowUpDraftsV2 | null,
): { document: SavedFollowUpDraftsV2; contextChanged: boolean } => {
  if (!saved) {
    return {
      document: createSavedFollowUpDrafts(
        composition.recommendedFormat,
        composition.evidenceFingerprint,
        composition.variants,
        [],
      ),
      contextChanged: false,
    };
  }
  if (saved.evidenceFingerprint === composition.evidenceFingerprint) {
    return { document: saved, contextChanged: false };
  }
  if (saved.editedFormats.length > 0) {
    return { document: saved, contextChanged: true };
  }
  return {
    document: createSavedFollowUpDrafts(
      saved.selectedFormat,
      composition.evidenceFingerprint,
      composition.variants,
      [],
    ),
    contextChanged: false,
  };
};

export const mergeRefinedVariants = (
  document: SavedFollowUpDraftsV2,
  refined: FollowUpVariants,
): SavedFollowUpDraftsV2 => ({
  ...document,
  variants: Object.fromEntries(
    FORMATS.map((format) => [
      format,
      document.editedFormats.includes(format)
        ? document.variants[format]
        : refined[format],
    ]),
  ) as FollowUpVariants,
});

export const parseRefinedVariants = (
  drafts: Array<{ title?: string; content?: string }> | undefined,
): FollowUpVariants | null => {
  if (!drafts) return null;
  const variants: Partial<FollowUpVariants> = {};
  for (const draft of drafts) {
    const title = draft.title?.trim().toLowerCase() || '';
    const content = draft.content?.trim() || '';
    const format = title.includes('slack')
      ? 'slack'
      : title.includes('internal')
        ? 'internal'
        : title.includes('email') || title.includes('client')
          ? 'email'
          : null;
    if (!format || !content || variants[format]) return null;
    variants[format] = content;
  }
  return isVariants(variants) ? variants : null;
};
