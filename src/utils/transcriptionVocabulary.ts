export const KNOWN_PERSON_VOCABULARY_POLICY_VERSION = 'explicit_participant_v1';
export const KNOWN_PERSON_VOCABULARY_MAX_HINTS = 12;
export const KNOWN_PERSON_VOCABULARY_MAX_PROMPT_CHARS = 240;

const PROMPT_PREFIX = 'Person names: ';
const MAX_NAME_CHARS = 48;
const SAFE_NAME = /^\p{L}[\p{L}\p{M}' -]*\p{L}$|^\p{L}$/u;

export type TranscriptionPersonCandidate = {
  name: string;
  saliencyScore?: number | null;
  meetingCount: number;
  mentionCount: number;
  lastMentionedAt?: string | null;
};

export type TranscriptionVocabularySelection = {
  initialPrompt: string | null;
  terms: string[];
  provenance: {
    policyVersion: typeof KNOWN_PERSON_VOCABULARY_POLICY_VERSION;
    hintCount: number;
  };
};

const normalizeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFKC')
    .replaceAll('’', "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_NAME_CHARS ||
    !SAFE_NAME.test(normalized)
  ) {
    return null;
  }
  return normalized;
};

export const buildTranscriptionParticipantHints = (
  participants: string[],
  calendarRoster: string[],
): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const value of [...participants, ...calendarRoster]) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
};

export const selectTranscriptionVocabulary = ({
  participants,
}: {
  participants: string[];
  candidates: TranscriptionPersonCandidate[];
  now?: number;
}): TranscriptionVocabularySelection => {
  const orderedNames = participants
    .map(normalizeName)
    .filter((name): name is string => !!name);
  const selectedNames: string[] = [];
  const deduped = new Set<string>();

  for (const name of orderedNames) {
    const key = name.toLocaleLowerCase('en-US');
    if (deduped.has(key)) continue;
    deduped.add(key);
    if (selectedNames.length >= KNOWN_PERSON_VOCABULARY_MAX_HINTS) break;
    const nextNames = [...selectedNames, name];
    const nextPrompt = `${PROMPT_PREFIX}${nextNames.join(', ')}.`;
    if (nextPrompt.length > KNOWN_PERSON_VOCABULARY_MAX_PROMPT_CHARS) {
      continue;
    }
    selectedNames.push(name);
  }

  return {
    initialPrompt:
      selectedNames.length > 0
        ? `${PROMPT_PREFIX}${selectedNames.join(', ')}.`
        : null,
    terms: selectedNames,
    provenance: {
      policyVersion: KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
      hintCount: selectedNames.length,
    },
  };
};
