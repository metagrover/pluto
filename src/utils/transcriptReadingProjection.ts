export type TranscriptReadingCandidate = {
  text?: unknown;
  speaker?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

export type TranscriptReadingSegment = TranscriptReadingCandidate & {
  text: string;
  speaker: string;
  startTime: number;
  endTime: number;
  wordingSource: 'recovered' | 'live';
};

export type TranscriptReadingProjectionMetadata = {
  version: 'utterance_reconciliation_v1';
  recoveredWordingSelections: number;
  liveWordingSelections: number;
  unresolvedSelections: number;
};

export type StoredLiveTranscriptInput = {
  id?: unknown;
  speaker?: unknown;
  text?: unknown;
  rawText?: unknown;
  source?: unknown;
  timestampMs?: unknown;
  endTimestampMs?: unknown;
  confirmed?: unknown;
};

export type StoredLiveTranscriptCandidate = TranscriptReadingCandidate & {
  id: string;
  text: string;
  speaker: string;
  startTime: number;
  endTime: number;
  validationState: 'validated' | 'preview';
};

type Utterance = {
  speaker: string;
  startTime: number;
  endTime: number;
  text: string;
  sourceSegments: TranscriptReadingCandidate[];
};

const MAX_UTTERANCE_GAP_SECONDS = 1.2;
const MINIMUM_ALIGNMENT_OVERLAP = 0.35;
const MINIMUM_TOKEN_SIMILARITY = 0.45;
const MAXIMUM_BOUNDARY_DISTANCE_SECONDS = 2;

export const toStoredLiveTranscriptCandidate = (
  segment: StoredLiveTranscriptInput,
): StoredLiveTranscriptCandidate => {
  const timestampMs = finiteTime(segment.timestampMs) ?? 0;
  const endTimestampMs = finiteTime(segment.endTimestampMs) ?? timestampMs + 10;
  return {
    id: typeof segment.id === 'string' ? segment.id : 'live-segment',
    speaker:
      segment.source === 'system'
        ? 'Them'
        : segment.source === 'mic'
          ? 'Me'
          : typeof segment.speaker === 'string'
            ? segment.speaker
            : 'Speaker',
    text:
      typeof segment.rawText === 'string' && segment.rawText.trim()
        ? segment.rawText
        : typeof segment.text === 'string'
          ? segment.text
          : '',
    startTime: Math.max(0, timestampMs / 1_000),
    endTime: Math.max(timestampMs + 10, endTimestampMs) / 1_000,
    validationState: segment.confirmed ? 'validated' : 'preview',
  };
};

const finiteTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const interval = (
  segment: TranscriptReadingCandidate,
): { startTime: number; endTime: number } | null => {
  const startTime = finiteTime(segment.startTime) ?? finiteTime(segment.start);
  const endTime = finiteTime(segment.endTime) ?? finiteTime(segment.end);
  return startTime !== null &&
    endTime !== null &&
    startTime >= 0 &&
    endTime > startTime
    ? { startTime, endTime }
    : null;
};

const normalizedTokens = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);

const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalizedTokens(left));
  const rightTokens = new Set(normalizedTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
};

const overlapRatio = (left: Utterance, right: Utterance): number => {
  const overlap = Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );
  return (
    overlap /
    Math.min(left.endTime - left.startTime, right.endTime - right.startTime)
  );
};

const aligned = (left: Utterance, right: Utterance): boolean =>
  overlapRatio(left, right) >= MINIMUM_ALIGNMENT_OVERLAP ||
  (Math.abs(left.startTime - right.startTime) <=
    MAXIMUM_BOUNDARY_DISTANCE_SECONDS &&
    Math.abs(left.endTime - right.endTime) <=
      MAXIMUM_BOUNDARY_DISTANCE_SECONDS &&
    tokenSimilarity(left.text, right.text) >= MINIMUM_TOKEN_SIMILARITY);

const buildUtterances = (
  segments: ReadonlyArray<TranscriptReadingCandidate>,
): Utterance[] => {
  const utterances: Utterance[] = [];
  const sorted = segments
    .map((segment) => ({ segment, timing: interval(segment) }))
    .filter(
      (
        entry,
      ): entry is {
        segment: TranscriptReadingCandidate;
        timing: { startTime: number; endTime: number };
      } =>
        entry.timing !== null &&
        typeof entry.segment.text === 'string' &&
        entry.segment.text.trim().length > 0,
    )
    .sort(
      (left, right) =>
        left.timing.startTime - right.timing.startTime ||
        left.timing.endTime - right.timing.endTime,
    );

  for (const { segment, timing } of sorted) {
    const speaker =
      typeof segment.speaker === 'string' && segment.speaker.trim()
        ? segment.speaker.trim()
        : 'Speaker';
    const text = String(segment.text).trim().replace(/\s+/g, ' ');
    const previous = utterances.at(-1);
    if (
      previous &&
      previous.speaker === speaker &&
      timing.startTime - previous.endTime <= MAX_UTTERANCE_GAP_SECONDS
    ) {
      previous.endTime = Math.max(previous.endTime, timing.endTime);
      previous.text = `${previous.text} ${text}`;
      previous.sourceSegments.push(segment);
      continue;
    }
    utterances.push({
      speaker,
      startTime: timing.startTime,
      endTime: timing.endTime,
      text,
      sourceSegments: [segment],
    });
  }
  return utterances;
};

const repeatedTokenRate = (tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const repeated = [...counts.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  return repeated / tokens.length;
};

const structuralQuality = (utterance: Utterance): number => {
  const tokens = normalizedTokens(utterance.text);
  if (tokens.length === 0) return Number.NEGATIVE_INFINITY;
  const uniqueRatio = new Set(tokens).size / tokens.length;
  const shortFragmentRate =
    utterance.sourceSegments.filter((segment) =>
      typeof segment.text === 'string'
        ? normalizedTokens(segment.text).length <= 3
        : true,
    ).length / utterance.sourceSegments.length;
  const punctuation = /[.!?]["')\]]?$/u.test(utterance.text) ? 0.35 : 0;
  return (
    uniqueRatio * 2 +
    punctuation -
    repeatedTokenRate(tokens) * 2 -
    shortFragmentRate * 0.45
  );
};

const hasNonDuplicatedRecoveredWords = (
  recovered: Utterance,
  live: Utterance,
): boolean => {
  const recoveredTokens = normalizedTokens(recovered.text);
  const liveTokens = normalizedTokens(live.text);
  const recoveredSet = new Set(recoveredTokens);
  const liveSet = new Set(liveTokens);
  const containsLive = [...liveSet].every((token) => recoveredSet.has(token));
  return (
    containsLive &&
    recoveredSet.size > liveSet.size &&
    repeatedTokenRate(recoveredTokens) <= repeatedTokenRate(liveTokens) + 0.1
  );
};

const readingSegment = (
  evidence: Utterance,
  wording: Utterance,
  wordingSource: 'recovered' | 'live',
): TranscriptReadingSegment => ({
  ...evidence.sourceSegments[0],
  speaker: evidence.speaker,
  startTime: evidence.startTime,
  endTime: evidence.endTime,
  text: wording.text,
  wordingSource,
});

export const buildTranscriptReadingProjection = (input: {
  recoveredSegments: ReadonlyArray<TranscriptReadingCandidate>;
  liveSegments?: ReadonlyArray<TranscriptReadingCandidate>;
}): {
  segments: TranscriptReadingSegment[];
  metadata: TranscriptReadingProjectionMetadata;
} => {
  const recovered = buildUtterances(input.recoveredSegments);
  const live = buildUtterances(input.liveSegments ?? []);
  const usedLive = new Set<number>();
  const segments: TranscriptReadingSegment[] = [];
  const metadata: TranscriptReadingProjectionMetadata = {
    version: 'utterance_reconciliation_v1',
    recoveredWordingSelections: 0,
    liveWordingSelections: 0,
    unresolvedSelections: 0,
  };

  for (const recoveredUtterance of recovered) {
    let liveIndex = -1;
    let bestOverlap = -1;
    for (let index = 0; index < live.length; index += 1) {
      if (usedLive.has(index) || !aligned(recoveredUtterance, live[index])) {
        continue;
      }
      const overlap = overlapRatio(recoveredUtterance, live[index]);
      if (overlap > bestOverlap) {
        liveIndex = index;
        bestOverlap = overlap;
      }
    }
    if (liveIndex < 0) {
      segments.push(
        readingSegment(recoveredUtterance, recoveredUtterance, 'recovered'),
      );
      metadata.recoveredWordingSelections += 1;
      continue;
    }

    usedLive.add(liveIndex);
    const liveUtterance = live[liveIndex];
    const recoveredQuality = structuralQuality(recoveredUtterance);
    const liveQuality = structuralQuality(liveUtterance);
    const liveWins =
      !hasNonDuplicatedRecoveredWords(recoveredUtterance, liveUtterance) &&
      liveQuality > recoveredQuality + 0.15;
    if (liveWins) {
      segments.push(readingSegment(recoveredUtterance, liveUtterance, 'live'));
      metadata.liveWordingSelections += 1;
    } else {
      segments.push(
        readingSegment(recoveredUtterance, recoveredUtterance, 'recovered'),
      );
      metadata.recoveredWordingSelections += 1;
      if (Math.abs(liveQuality - recoveredQuality) <= 0.15) {
        metadata.unresolvedSelections += 1;
      }
    }
  }

  for (let index = 0; index < live.length; index += 1) {
    if (usedLive.has(index)) continue;
    segments.push(readingSegment(live[index], live[index], 'live'));
    metadata.liveWordingSelections += 1;
  }

  segments.sort(
    (left, right) =>
      left.startTime - right.startTime || left.endTime - right.endTime,
  );
  return { segments, metadata };
};
