export const KNOWN_PERSON_VOCABULARY_POLICY_VERSION = 'known_person_v1';
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

const recencyBucket = (value: string | null | undefined, now: number) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, now - timestamp) / 86_400_000;
  if (ageDays <= 7) return 4;
  if (ageDays <= 30) return 3;
  if (ageDays <= 90) return 2;
  return 1;
};

const finiteScore = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const compareText = (left: string, right: string) => {
  const normalizedLeft = left.toLocaleLowerCase('en-US');
  const normalizedRight = right.toLocaleLowerCase('en-US');
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
};

export const selectTranscriptionVocabulary = ({
  participants,
  candidates,
  now = Date.now(),
}: {
  participants: string[];
  candidates: TranscriptionPersonCandidate[];
  now?: number;
}): TranscriptionVocabularySelection => {
  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      normalizedName: normalizeName(candidate.name),
      recency: recencyBucket(candidate.lastMentionedAt, now),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { normalizedName: string } =>
        candidate.normalizedName !== null,
    )
    .sort((left, right) => {
      const saliency =
        finiteScore(right.saliencyScore) - finiteScore(left.saliencyScore);
      if (saliency !== 0) return saliency;
      if (right.recency !== left.recency) return right.recency - left.recency;
      if (right.meetingCount !== left.meetingCount) {
        return right.meetingCount - left.meetingCount;
      }
      if (right.mentionCount !== left.mentionCount) {
        return right.mentionCount - left.mentionCount;
      }
      return compareText(left.normalizedName, right.normalizedName);
    });

  const orderedNames = [
    ...participants.map(normalizeName).filter((name): name is string => !!name),
    ...rankedCandidates.map((candidate) => candidate.normalizedName),
  ];
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
