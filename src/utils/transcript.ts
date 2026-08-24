import { formatReadableTranscriptForAnalysis } from './readableTranscript.ts';

interface TranscriptSegmentLike {
  text?: unknown;
  speaker?: unknown;
}

export const getTranscriptSegmentStartTime = (segment: {
  start?: unknown;
  startTime?: unknown;
}): number => {
  const value =
    typeof segment.start === 'number' ? segment.start : segment.startTime;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
};

/** Parse legacy array or v2 `{ segments }` wrapper. */
export const parseTranscriptSegments = (
  transcriptJson?: string | null,
): TranscriptSegmentLike[] => {
  if (!transcriptJson || !transcriptJson.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(transcriptJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as TranscriptSegmentLike[];
    }
    if (parsed && typeof parsed === 'object') {
      const segments = (parsed as { segments?: unknown }).segments;
      if (Array.isArray(segments)) {
        return segments as TranscriptSegmentLike[];
      }
    }
    return [];
  } catch {
    return [];
  }
};

export const isTranscriptJsonEffectivelyEmpty = (
  transcriptJson?: string | null,
): boolean => {
  return parseTranscriptSegments(transcriptJson).length === 0;
};

export const buildAnalysisTranscriptFromJson = (
  transcriptJson?: string | null,
): string => {
  const segments = parseTranscriptSegments(transcriptJson);
  return formatReadableTranscriptForAnalysis(segments);
};
