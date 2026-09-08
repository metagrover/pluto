import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../../utils/speakerAttribution.ts';
import type { StoredTranscriptSpeakerAttribution } from '../../utils/transcriptSchema.ts';

const MINIMUM_LOCAL_COVERAGE = 0.5;
const MINIMUM_CONCURRENT_SYSTEM_COVERAGE = 0.5;
const MINIMUM_ATTRIBUTION_CONFIDENCE = 0.8;

export type SpeakerAttributionDiagnostics = {
  schemaVersion: 1;
  pipelineVersion: 'recovered_channel_acoustic_v2';
  confidence: number;
  minimumConfidence: number;
  attributedSeconds: number;
  unattributedSeconds: number;
  totalSeconds: number;
};

type Interval = { startTime: number; endTime: number };

const evidenceIntervals = (segment: AttributionSegment): Interval[] => {
  const words = segment.words?.flatMap((word) =>
    Number.isFinite(word.start) &&
    Number.isFinite(word.end) &&
    word.end > word.start
      ? [{ startTime: word.start, endTime: word.end }]
      : [],
  );
  return words?.length
    ? words
    : [{ startTime: segment.startTime, endTime: segment.endTime }];
};

const intervalSeconds = (intervals: Interval[]): number =>
  intervals.reduce(
    (total, interval) =>
      total + Math.max(0, interval.endTime - interval.startTime),
    0,
  );

// Merge once, then visit only intervals overlapping each query. Duplicate
// observations are evidence of the same time, not additional speech duration.
const coverageReader = (input: Interval[]) => {
  const intervals: Interval[] = [];
  for (const interval of [...input].sort((a, b) => a.startTime - b.startTime)) {
    if (
      !Number.isFinite(interval.startTime) ||
      !Number.isFinite(interval.endTime) ||
      interval.endTime <= interval.startTime
    )
      continue;
    const previous = intervals.at(-1);
    if (previous && interval.startTime <= previous.endTime) {
      previous.endTime = Math.max(previous.endTime, interval.endTime);
    } else {
      intervals.push({
        startTime: interval.startTime,
        endTime: interval.endTime,
      });
    }
  }
  return (query: Interval): number => {
    let low = 0;
    let high = intervals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (intervals[middle].endTime <= query.startTime) low = middle + 1;
      else high = middle;
    }
    let seconds = 0;
    for (let index = low; index < intervals.length; index++) {
      const interval = intervals[index];
      if (interval.startTime >= query.endTime) break;
      seconds += Math.max(
        0,
        Math.min(query.endTime, interval.endTime) -
          Math.max(query.startTime, interval.startTime),
      );
    }
    return seconds;
  };
};

export const applyRecoveredChannelEvidence = <
  T extends AttributionSegment,
>(input: {
  segments: T[];
  activityWindows: SpeakerActivityWindow[];
  provenance: {
    runtimeVersion: string;
    modelRevision: string;
    artifactDigest: string;
  };
}): {
  accepted: boolean;
  segments: T[];
  attribution: StoredTranscriptSpeakerAttribution;
  diagnostics: SpeakerAttributionDiagnostics;
  reasons: ['low_attribution_confidence'] | [];
} => {
  const systemCoverage = coverageReader(
    input.segments
      .filter((segment) => segment.speaker === 'Them')
      .flatMap(evidenceIntervals),
  );
  let localCoverage: ReturnType<typeof coverageReader> | undefined;
  const segments = input.segments.map((segment) => {
    if (segment.speaker === 'Them' || segment.speaker === 'Unknown') {
      return { ...segment } as T;
    }
    // Historical retries may preserve a label that fresh channel evidence
    // could not resolve. Its name does not establish microphone ownership.
    if (segment.speaker !== 'Me')
      return { ...segment, speaker: 'Unknown' } as T;
    const intervals = evidenceIntervals(segment);
    const duration = Math.max(0.01, intervalSeconds(intervals));
    const concurrentSystemSeconds = intervals.reduce(
      (total, interval) => total + systemCoverage(interval),
      0,
    );
    if (
      concurrentSystemSeconds / duration <
      MINIMUM_CONCURRENT_SYSTEM_COVERAGE
    ) {
      return { ...segment, speaker: 'Me', nearEndEvidence: true } as T;
    }
    localCoverage ??= coverageReader(
      input.activityWindows.filter((window) => window.speaker === 'Me'),
    );
    const localSeconds = intervals.reduce(
      (total, interval) => total + (localCoverage?.(interval) ?? 0),
      0,
    );
    if (localSeconds / duration >= MINIMUM_LOCAL_COVERAGE) {
      return { ...segment, speaker: 'Me', nearEndEvidence: true } as T;
    }
    return { ...segment, speaker: 'Unknown' } as T;
  });
  const totalSeconds = segments.reduce(
    (total, segment) => total + intervalSeconds(evidenceIntervals(segment)),
    0,
  );
  const attributedSeconds = segments.reduce(
    (total, segment) =>
      total +
      (segment.speaker === 'Unknown'
        ? 0
        : intervalSeconds(evidenceIntervals(segment))),
    0,
  );
  const confidence =
    totalSeconds > 0 ? Math.min(1, attributedSeconds / totalSeconds) : 1;
  const accepted = confidence >= MINIMUM_ATTRIBUTION_CONFIDENCE;
  return {
    accepted,
    segments,
    reasons: accepted ? [] : ['low_attribution_confidence'],
    attribution: {
      source: 'recovered_channel_acoustic_v2',
      confidence,
      diarizationAttempted: true,
      mappingApplied: accepted,
      ...(accepted ? {} : { fallbackReason: 'low_confidence' as const }),
      nearEndEvidenceAttempted: true,
      engineVersion: `${input.provenance.runtimeVersion}@${input.provenance.modelRevision}`,
      modelChecksums: [input.provenance.artifactDigest],
    },
    diagnostics: {
      schemaVersion: 1,
      pipelineVersion: 'recovered_channel_acoustic_v2',
      confidence,
      minimumConfidence: MINIMUM_ATTRIBUTION_CONFIDENCE,
      attributedSeconds,
      unattributedSeconds: Math.max(0, totalSeconds - attributedSeconds),
      totalSeconds,
    },
  };
};
