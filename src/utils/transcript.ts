import { buildReadableTranscriptSegments } from './readableTranscript.ts';
import {
  type TranscriptReadingCandidate,
  assembleReadableTranscriptSentences,
  buildTranscriptReadingProjection,
  projectTranscriptSpeakerContinuity,
} from './transcriptReadingProjection.ts';

interface TranscriptSegmentLike {
  text?: unknown;
  speaker?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}

const MINIMUM_CONFIDENT_MIC_WORDS = 4;
const MINIMUM_REMOTE_DOMINANT_OVERLAP = 0.5;

const finiteTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const wordCount = (value: unknown): number =>
  typeof value === 'string'
    ? value.trim().split(/\s+/).filter(Boolean).length
    : 0;

type TimedInterval = { start: number; end: number };

const toTimedInterval = (
  segment: TranscriptSegmentLike,
): TimedInterval | null => {
  const start = finiteTime(segment.startTime) ?? finiteTime(segment.start);
  const end = finiteTime(segment.endTime) ?? finiteTime(segment.end);
  return start !== null && end !== null && start >= 0 && end > start
    ? { start, end }
    : null;
};

const coveredOverlapRatio = (
  segment: TranscriptSegmentLike,
  candidates: ReadonlyArray<TimedInterval>,
): number => {
  const interval = toTimedInterval(segment);
  if (!interval) return 0;

  let covered = 0;
  let coveredThrough = interval.start;
  for (const candidate of candidates) {
    if (candidate.end <= interval.start) continue;
    if (candidate.start >= interval.end) break;
    const overlapStart = Math.max(
      interval.start,
      candidate.start,
      coveredThrough,
    );
    const overlapEnd = Math.min(interval.end, candidate.end);
    if (overlapEnd > overlapStart) {
      covered += overlapEnd - overlapStart;
      coveredThrough = overlapEnd;
    }
    if (coveredThrough >= interval.end) break;
  }
  return covered / (interval.end - interval.start);
};

const hasValidTimeRange = (segment: TranscriptSegmentLike): boolean => {
  return toTimedInterval(segment) !== null;
};

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

export const parseTranscriptSegmentsForPresentation = (
  transcriptJson?: string | null,
): TranscriptSegmentLike[] => {
  const segments = parseTranscriptSegments(transcriptJson);
  return applyTranscriptSpeakerPresentation(transcriptJson, segments);
};

export const applyTranscriptSpeakerPresentation = <
  T extends TranscriptSegmentLike,
>(
  transcriptJson: string | null | undefined,
  segments: T[],
): T[] => {
  if (!transcriptJson?.trim()) return segments;
  try {
    const parsed = JSON.parse(transcriptJson) as {
      speakerAttribution?: { mappingApplied?: unknown };
    };
    if (parsed?.speakerAttribution?.mappingApplied !== false) return segments;
    const remoteIntervals = segments
      .filter((segment) => segment.speaker === 'Them')
      .map(toTimedInterval)
      .filter((interval): interval is TimedInterval => interval !== null)
      .sort((left, right) => left.start - right.start);
    return segments.map((segment) => {
      if (segment.speaker === 'Them') return segment;
      if (segment.speaker === 'Me') {
        if (!hasValidTimeRange(segment)) {
          return { ...segment, speaker: 'Speaker' } as T;
        }
        const remoteOverlap = coveredOverlapRatio(segment, remoteIntervals);
        if (remoteOverlap >= MINIMUM_REMOTE_DOMINANT_OVERLAP) {
          return { ...segment, speaker: 'Speaker' } as T;
        }
        if (
          wordCount(segment.text) >= MINIMUM_CONFIDENT_MIC_WORDS &&
          remoteOverlap < MINIMUM_REMOTE_DOMINANT_OVERLAP
        ) {
          return segment;
        }
      }
      return { ...segment, speaker: 'Speaker' } as T;
    });
  } catch {
    return segments;
  }
};

export const buildTranscriptSegmentsForPresentation = <
  T extends TranscriptSegmentLike,
>(
  transcriptJson: string | null | undefined,
  segments: T[],
): Array<T & { text: string }> => {
  const recoveredSegments = buildReadableTranscriptSegments(segments).segments;
  let liveSegments: TranscriptReadingCandidate[] = [];
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as {
      liveSegments?: unknown;
      pipelineMode?: unknown;
      canonicalSource?: unknown;
      lifecycleStatus?: unknown;
      speakerAttribution?: { source?: unknown };
    };
    // Finalization has already reconciled sources and rejected unsafe evidence.
    // Retain live rows on disk, but never resurrect their text or speaker labels
    // in a completed canonical transcript (including a no-speech result).
    const finalRecovered =
      parsed.pipelineMode === 'parakeet_final_v1' &&
      parsed.canonicalSource === 'recovered_channels' &&
      (parsed.lifecycleStatus === 'validated' ||
        parsed.speakerAttribution?.source === 'recovered_channel_acoustic_v1' ||
        parsed.speakerAttribution?.source === 'recovered_channel_acoustic_v2');
    if (!finalRecovered && Array.isArray(parsed.liveSegments)) {
      liveSegments = buildReadableTranscriptSegments(
        parsed.liveSegments as TranscriptReadingCandidate[],
      ).segments;
    }
  } catch {
    liveSegments = [];
  }
  const reading: TranscriptSegmentLike[] = liveSegments.length
    ? buildTranscriptReadingProjection({
        recoveredSegments,
        liveSegments,
      }).segments
    : recoveredSegments;
  const attributed = applyTranscriptSpeakerPresentation(
    transcriptJson,
    reading,
  );
  const continuous = projectTranscriptSpeakerContinuity(attributed);
  return assembleReadableTranscriptSentences(continuous) as unknown as Array<
    T & { text: string }
  >;
};

export const isTranscriptJsonEffectivelyEmpty = (
  transcriptJson?: string | null,
): boolean => {
  return parseTranscriptSegments(transcriptJson).length === 0;
};

export const buildAnalysisTranscriptFromJson = (
  transcriptJson?: string | null,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): string => {
  return buildTranscriptSegmentsForPresentation(
    transcriptJson,
    parseTranscriptSegments(transcriptJson),
  )
    .map((segment) => {
      const speaker =
        typeof segment.speaker === 'string' ||
        typeof segment.speaker === 'number'
          ? String(segment.speaker).trim()
          : '';
      const projectedSpeaker =
        (speaker ? speakerDisplayNames[speaker]?.trim() : '') || speaker;
      return projectedSpeaker
        ? `${projectedSpeaker}: ${segment.text}`
        : segment.text;
    })
    .join('\n');
};
