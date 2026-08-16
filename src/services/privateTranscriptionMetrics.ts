export type TimedText = {
  text: string;
  start: number;
  end: number;
};

export type TimedToken = {
  token: string;
  at: number;
};

export type PrivateReviewWord = {
  startSeconds: number;
  endSeconds: number;
};

export type PrivateEvaluationSources = {
  micPath: string | null;
  micDurationSeconds: number | null;
  systemPath: string | null;
  systemDurationSeconds: number | null;
};

export const isIndependentPrivateMicSource = (
  micPath: string | null,
  mixedPath: string | null,
): boolean => Boolean(micPath && (!mixedPath || micPath !== mixedPath));

export const privateEvaluationSourceDuration = (
  audioPath: string,
  sources: PrivateEvaluationSources,
): number | null => {
  if (audioPath === sources.micPath) return sources.micDurationSeconds;
  if (audioPath === sources.systemPath) return sources.systemDurationSeconds;
  return null;
};

export const arePrivateReviewSourcesAligned = (
  recordingDurationSeconds: number,
  sourceDurationSeconds: Array<number | null | undefined>,
  maximumMismatchSeconds = 5,
): boolean =>
  Number.isFinite(recordingDurationSeconds) &&
  recordingDurationSeconds > 0 &&
  sourceDurationSeconds.length === 2 &&
  sourceDurationSeconds.every(
    (duration) =>
      typeof duration === 'number' &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Math.abs(duration - recordingDurationSeconds) <= maximumMismatchSeconds,
  );

export const privateReviewTimelineDuration = (
  recordingDurationSeconds: number,
  sourceDurationSeconds: Array<number | null | undefined>,
): number | null =>
  arePrivateReviewSourcesAligned(
    recordingDurationSeconds,
    sourceDurationSeconds,
  )
    ? Math.min(recordingDurationSeconds, ...(sourceDurationSeconds as number[]))
    : null;

export const hasPrivateReviewSpeechInWindow = (
  words: PrivateReviewWord[],
  startSeconds: number,
  endSeconds: number,
  minimumWordCount = 3,
): boolean =>
  words.filter(
    (word) => word.startSeconds < endSeconds && word.endSeconds > startSeconds,
  ).length >= minimumWordCount;

const privateEvaluationFailureCodes = new Set([
  'parakeet_request_invalid',
  'parakeet_path_not_allowed',
  'parakeet_path_missing',
  'parakeet_model_preparation_failed',
  'parakeet_transcription_failed',
  'parakeet_cancelled',
  'parakeet_protocol_invalid',
  'parakeet_process_exited',
  'parakeet_request_timeout',
]);

export const normalizePrivateEvaluationFailureCode = (
  value: unknown,
): string =>
  typeof value === 'string' && privateEvaluationFailureCodes.has(value)
    ? value
    : 'parakeet_failure_unknown';

export const normalizeTranscriptTokens = (text: string): string[] =>
  text
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const transcriptEditDistance = (left: string[], right: string[]) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

export const multisetTokenIntersectionSize = (
  left: string[],
  right: string[],
) => {
  const remaining = new Map<string, number>();
  for (const token of right) {
    remaining.set(token, (remaining.get(token) || 0) + 1);
  }
  let intersection = 0;
  for (const token of left) {
    const count = remaining.get(token) || 0;
    if (count <= 0) continue;
    intersection += 1;
    remaining.set(token, count - 1);
  }
  return intersection;
};

export const distributeTimedTokens = (segments: TimedText[]): TimedToken[] =>
  segments.flatMap((segment) => {
    const tokens = normalizeTranscriptTokens(segment.text);
    if (
      tokens.length === 0 ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end < segment.start
    ) {
      return [];
    }
    const duration = segment.end - segment.start;
    return tokens.map((token, index) => ({
      token,
      at: segment.start + (duration * (index + 0.5)) / tokens.length,
    }));
  });

export const matchTimeAlignedTokens = (
  reference: TimedToken[],
  candidate: TimedToken[],
  toleranceSeconds = 2,
) => {
  const candidatesByToken = new Map<
    string,
    Array<{ index: number; at: number }>
  >();
  candidate.forEach((entry, index) => {
    const matches = candidatesByToken.get(entry.token) || [];
    matches.push({ index, at: entry.at });
    candidatesByToken.set(entry.token, matches);
  });
  const used = new Set<number>();
  let matched = 0;
  for (const expected of reference) {
    const match = (candidatesByToken.get(expected.token) || [])
      .filter(
        (entry) =>
          !used.has(entry.index) &&
          Math.abs(entry.at - expected.at) <= toleranceSeconds,
      )
      .sort(
        (left, right) =>
          Math.abs(left.at - expected.at) - Math.abs(right.at - expected.at),
      )[0];
    if (!match) continue;
    used.add(match.index);
    matched += 1;
  }
  return {
    matched,
    precision: matched / Math.max(1, candidate.length),
    recall: matched / Math.max(1, reference.length),
  };
};
