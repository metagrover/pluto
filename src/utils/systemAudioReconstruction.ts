export interface TimedAudioChunk {
  chunkIndex: number;
  path: string;
  startSec: number;
  endSec: number;
}

export interface SystemAudioFallbackDecisionParams {
  primaryDurationSec: number;
  meetingDurationSec: number;
  chunks: TimedAudioChunk[];
}

const MIN_PRIMARY_DURATION_SEC = 1;
const MIN_FALLBACK_COVERAGE_SEC = 5;
const MIN_FALLBACK_COVERAGE_RATIO = 0.15;

export const getChunkCoverageSeconds = (chunks: TimedAudioChunk[]): number => {
  if (chunks.length === 0) return 0;
  const sorted = [...chunks]
    .filter(
      (chunk) =>
        Number.isFinite(chunk.startSec) &&
        Number.isFinite(chunk.endSec) &&
        chunk.endSec > chunk.startSec,
    )
    .sort((left, right) => left.startSec - right.startSec);

  if (sorted.length === 0) return 0;

  let coverage = 0;
  let windowStart = sorted[0].startSec;
  let windowEnd = sorted[0].endSec;

  for (let i = 1; i < sorted.length; i++) {
    const chunk = sorted[i];
    if (chunk.startSec <= windowEnd) {
      windowEnd = Math.max(windowEnd, chunk.endSec);
      continue;
    }
    coverage += Math.max(0, windowEnd - windowStart);
    windowStart = chunk.startSec;
    windowEnd = chunk.endSec;
  }

  coverage += Math.max(0, windowEnd - windowStart);
  return coverage;
};

export const shouldUseSystemAudioReconstructionFallback = (
  params: SystemAudioFallbackDecisionParams,
): boolean => {
  const { primaryDurationSec, meetingDurationSec, chunks } = params;
  if (primaryDurationSec >= MIN_PRIMARY_DURATION_SEC) return false;

  const coverageSec = getChunkCoverageSeconds(chunks);
  if (coverageSec < MIN_FALLBACK_COVERAGE_SEC) return false;

  const normalizedMeetingDuration = Math.max(1, meetingDurationSec);
  return coverageSec / normalizedMeetingDuration >= MIN_FALLBACK_COVERAGE_RATIO;
};
