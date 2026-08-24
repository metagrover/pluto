export type ReadableTranscriptSegment = {
  text?: unknown;
  speaker?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

export type TranscriptReadabilityStats = {
  inputSegments: number;
  outputSegments: number;
  fillerTokenCount: number;
  totalTokenCount: number;
  exactDuplicateSegmentCount: number;
  embeddedFragmentCount: number;
};

const normalizedToken = (value: string): string =>
  value
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();

const normalizedText = (value: string): string =>
  value.split(/\s+/).map(normalizedToken).filter(Boolean).join(' ');

const textTokens = (value: string): string[] =>
  value.split(/\s+/).map(normalizedToken).filter(Boolean);

const isFiller = (token: string): boolean => token === 'um' || token === 'uh';

const cleanReadableText = (value: string): string =>
  value
    .split(/\s+/)
    .filter((token) => !isFiller(normalizedToken(token)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const finiteTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizedSpeaker = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLocaleLowerCase('en')
    : '';

const isEmbeddedLetterArtifact = (
  segment: ReadableTranscriptSegment,
  segments: ReadonlyArray<ReadableTranscriptSegment>,
): boolean => {
  if (normalizedSpeaker(segment.speaker) !== 'me') return false;
  const text = typeof segment.text === 'string' ? segment.text : '';
  if (!/^\p{L}$/u.test(normalizedText(text))) return false;
  const startTime = finiteTime(segment.startTime);
  const endTime = finiteTime(segment.endTime);
  if (
    startTime === null ||
    endTime === null ||
    endTime < startTime ||
    endTime - startTime > 0.25
  ) {
    return false;
  }

  return segments.some((candidate) => {
    if (normalizedSpeaker(candidate.speaker) !== 'them') return false;
    const candidateStart = finiteTime(candidate.startTime);
    const candidateEnd = finiteTime(candidate.endTime);
    const candidateText =
      typeof candidate.text === 'string' ? candidate.text : '';
    return (
      candidateStart !== null &&
      candidateEnd !== null &&
      candidateEnd - candidateStart >= 2 &&
      textTokens(candidateText).length >= 3 &&
      startTime >= candidateStart &&
      endTime <= candidateEnd
    );
  });
};

export const buildReadableTranscriptSegments = <
  T extends ReadableTranscriptSegment,
>(
  input: ReadonlyArray<T>,
): {
  segments: Array<T & { text: string }>;
  stats: TranscriptReadabilityStats;
} => {
  const seenExact = new Set<string>();
  const segments: Array<T & { text: string }> = [];
  let fillerTokenCount = 0;
  let totalTokenCount = 0;
  let exactDuplicateSegmentCount = 0;
  let embeddedFragmentCount = 0;

  input.forEach((segment, index) => {
    if (!segment || typeof segment.text !== 'string') return;
    const tokens = textTokens(segment.text);
    totalTokenCount += tokens.length;
    fillerTokenCount += tokens.filter(isFiller).length;

    const startTime = finiteTime(segment.startTime);
    const endTime = finiteTime(segment.endTime);
    const exactKey =
      startTime !== null && endTime !== null
        ? `${normalizedSpeaker(segment.speaker)}|${startTime}|${endTime}|${normalizedText(segment.text)}`
        : `missing-time:${index}`;
    if (seenExact.has(exactKey)) {
      exactDuplicateSegmentCount += 1;
      return;
    }
    seenExact.add(exactKey);

    const text = cleanReadableText(segment.text);
    if (isEmbeddedLetterArtifact({ ...segment, text }, input)) {
      embeddedFragmentCount += 1;
      return;
    }

    if (!text) return;
    segments.push({ ...segment, text });
  });

  return {
    segments,
    stats: {
      inputSegments: input.length,
      outputSegments: segments.length,
      fillerTokenCount,
      totalTokenCount,
      exactDuplicateSegmentCount,
      embeddedFragmentCount,
    },
  };
};

export const formatReadableTranscriptForAnalysis = (
  segments: ReadonlyArray<ReadableTranscriptSegment>,
): string =>
  buildReadableTranscriptSegments(segments)
    .segments.map((segment) => {
      const speaker =
        typeof segment.speaker === 'string' ||
        typeof segment.speaker === 'number'
          ? String(segment.speaker).trim()
          : '';
      return speaker ? `${speaker}: ${segment.text}` : segment.text;
    })
    .join('\n');
