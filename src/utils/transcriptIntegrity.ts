import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from './speakerAttribution.ts';
import { resolveCrossChannelDuplicates } from './speakerAttribution.ts';

export type TranscriptLifecycleStatus =
  | 'provisional'
  | 'validating'
  | 'validated'
  | 'needs_attention';

export type TranscriptIntegrityReason =
  | 'local_transcript_coverage_low'
  | 'local_speech_unaccounted'
  | 'remote_speech_unaccounted'
  | 'deterministic_retry_evidence_missing'
  | 'deterministic_retry_evidence_corrupt'
  | 'capture_activity_missing'
  | 'capture_activity_corrupt'
  | 'capture_activity_unsupported'
  | 'capture_journal_write_failed'
  | 'required_source_failed'
  | 'channel_duration_mismatch'
  | 'ambiguous_pass_through';

export type TranscriptIntegrityEvidence = {
  micActivitySeconds: number;
  systemActivitySeconds: number;
  localTranscriptCoveredSeconds: number;
  remoteTranscriptCoveredSeconds: number;
  unexplainedMicSeconds: number;
  unexplainedSystemSeconds: number;
  collapsedPassThroughSeconds: number;
  unresolvedAmbiguousSeconds: number;
  rejectedMicCandidateSeconds?: number;
  rejectedSystemCandidateSeconds?: number;
};

const coverageRatio = (coveredSeconds: number, activeSeconds: number) =>
  activeSeconds <= 0
    ? 1
    : Math.max(0, coveredSeconds) / Math.max(0, activeSeconds);

export const evaluateLiveTranscriptCoverage = (input: {
  micActivitySeconds: number;
  localTranscriptSeconds: number;
  conversionFailed: boolean;
  priorRetries: number;
}) => {
  const lowCoverage =
    input.micActivitySeconds >= 3 &&
    coverageRatio(input.localTranscriptSeconds, input.micActivitySeconds) <
      0.35;

  if (!input.conversionFailed && !lowCoverage) {
    return {
      state: 'healthy' as const,
      shouldRetry: false,
      reason: null,
    };
  }

  return {
    state: 'lagging' as const,
    shouldRetry: input.priorRetries < 1,
    reason: input.conversionFailed
      ? ('required_source_failed' as const)
      : ('local_transcript_coverage_low' as const),
  };
};

const overlapSeconds = (left: AttributionSegment, right: AttributionSegment) =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

const activityOverlapSeconds = (
  segment: AttributionSegment,
  speaker: 'Me' | 'Them',
  windows: SpeakerActivityWindow[],
) =>
  windows
    .filter((window) => window.speaker === speaker)
    .reduce(
      (total, window) =>
        total +
        Math.max(
          0,
          Math.min(segment.endTime, window.endTime) -
            Math.max(segment.startTime, window.startTime),
        ),
      0,
    );

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenSimilarity = (left: string, right: string) => {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
};

const maxOverlapSeconds = (
  segment: AttributionSegment,
  candidates: AttributionSegment[],
) =>
  candidates.reduce(
    (maximum, candidate) =>
      Math.max(maximum, overlapSeconds(segment, candidate)),
    0,
  );

export const reconcileCanonicalTranscript = <
  T extends AttributionSegment,
>(input: {
  mixedSegments: T[];
  micSegments: T[];
  systemSegments: T[];
  provisionalSegments: T[];
  activityWindows: SpeakerActivityWindow[];
}) => {
  const deduplicatedMixed = resolveCrossChannelDuplicates(
    input.mixedSegments,
  ).segments;
  let unresolvedAmbiguousSeconds = 0;
  const attributed = deduplicatedMixed.map((canonical) => {
    const preservedUnknown =
      canonical.speaker === 'Unknown' &&
      input.micSegments.some(
        (mic) =>
          mic.speaker === 'Unknown' &&
          overlapSeconds(canonical, mic) >= 0.25 &&
          tokenSimilarity(canonical.text, mic.text) >= 0.5,
      );
    if (preservedUnknown) return { ...canonical } as T;
    const micActivity = activityOverlapSeconds(
      canonical,
      'Me',
      input.activityWindows,
    );
    const systemActivity = activityOverlapSeconds(
      canonical,
      'Them',
      input.activityWindows,
    );
    const micEvidence = Math.max(
      micActivity,
      maxOverlapSeconds(canonical, input.micSegments),
    );
    const systemEvidence = Math.max(
      systemActivity,
      maxOverlapSeconds(canonical, input.systemSegments),
    );
    const provisionalSpeaker = input.provisionalSegments.find(
      (candidate) => overlapSeconds(canonical, candidate) >= 0.25,
    )?.speaker;
    const systemPassThrough = input.systemSegments.some(
      (system) =>
        overlapSeconds(canonical, system) >= 0.25 &&
        tokenSimilarity(canonical.text, system.text) >= 0.5,
    );
    const ambiguousPassThrough =
      systemPassThrough &&
      !canonical.words?.length &&
      micActivity > 0 &&
      Math.abs(micActivity - systemActivity) <= 0.05;
    if (ambiguousPassThrough) {
      unresolvedAmbiguousSeconds += canonical.endTime - canonical.startTime;
    }
    const speaker = systemPassThrough
      ? micActivity > systemActivity
        ? 'Me'
        : 'Them'
      : systemEvidence > micEvidence
        ? 'Them'
        : micEvidence > 0
          ? 'Me'
          : provisionalSpeaker || 'Unknown';
    return { ...canonical, speaker } as T;
  });

  const recoveredMicSegments = input.micSegments.filter(
    (mic) =>
      !attributed.some(
        (candidate) =>
          overlapSeconds(mic, candidate) >= 0.25 &&
          tokenSimilarity(mic.text, candidate.text) >= 0.5,
      ) &&
      !input.systemSegments.some(
        (system) =>
          overlapSeconds(mic, system) >= 0.25 &&
          tokenSimilarity(mic.text, system.text) >= 0.5,
      ),
  );

  const collapsedPassThroughSeconds = input.micSegments.reduce((total, mic) => {
    const duplicateSystem = input.systemSegments.find(
      (system) =>
        overlapSeconds(mic, system) >= 0.25 &&
        tokenSimilarity(mic.text, system.text) >= 0.5,
    );
    return duplicateSystem
      ? total + overlapSeconds(mic, duplicateSystem)
      : total;
  }, 0);
  const seenCanonicalSegments = new Set<string>();
  const segments = [...attributed, ...recoveredMicSegments]
    .sort((left, right) => left.startTime - right.startTime)
    .filter((segment) => {
      const key = `${segment.speaker}|${segment.startTime}|${segment.endTime}|${normalizeText(segment.text)}`;
      if (seenCanonicalSegments.has(key)) return false;
      seenCanonicalSegments.add(key);
      return true;
    });

  return {
    segments,
    evidence: {
      collapsedPassThroughSeconds,
      unresolvedAmbiguousSeconds,
    },
  };
};

export const validateTranscriptIntegrity = (input: {
  recordingDurationSeconds: number;
  micAudioDurationSeconds: number;
  systemAudioDurationSeconds: number;
  micActivitySeconds: number;
  systemActivitySeconds: number;
  localTranscriptCoveredSeconds: number;
  remoteTranscriptCoveredSeconds: number;
  localWordCount?: number;
  remoteWordCount?: number;
  collapsedPassThroughSeconds?: number;
  unresolvedAmbiguousSeconds: number;
  requiredSourcesSucceeded: boolean;
}) => {
  const reasons: TranscriptIntegrityReason[] = [];
  const durationToleranceSeconds = Math.max(
    3,
    input.recordingDurationSeconds * 0.03,
  );

  if (!input.requiredSourcesSucceeded) reasons.push('required_source_failed');

  if (
    Math.abs(input.micAudioDurationSeconds - input.recordingDurationSeconds) >
      durationToleranceSeconds ||
    Math.abs(
      input.systemAudioDurationSeconds - input.recordingDurationSeconds,
    ) > durationToleranceSeconds
  ) {
    reasons.push('channel_duration_mismatch');
  }

  if (
    input.micActivitySeconds >= 3 &&
    coverageRatio(
      input.localTranscriptCoveredSeconds +
        (input.collapsedPassThroughSeconds ?? 0),
      input.micActivitySeconds,
    ) < 0.65
  ) {
    reasons.push('local_speech_unaccounted');
  }

  if (input.systemActivitySeconds >= 3) {
    const timeCoverage =
      input.remoteTranscriptCoveredSeconds / input.systemActivitySeconds;
    if (timeCoverage < 0.65) {
      reasons.push('remote_speech_unaccounted');
    }
  }

  if (input.unresolvedAmbiguousSeconds > 3) {
    reasons.push('ambiguous_pass_through');
  }

  return {
    status:
      reasons.length === 0
        ? ('validated' as const)
        : ('needs_attention' as const),
    reasons,
  };
};
