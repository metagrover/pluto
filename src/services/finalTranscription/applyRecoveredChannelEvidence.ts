import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../../utils/speakerAttribution.ts';
import type { StoredTranscriptSpeakerAttribution } from '../../utils/transcriptSchema.ts';

const MINIMUM_LOCAL_COVERAGE = 0.5;
const MINIMUM_CONCURRENT_SYSTEM_COVERAGE = 0.5;
const MINIMUM_ATTRIBUTION_CONFIDENCE = 0.8;

const activitySeconds = (
  segment: AttributionSegment,
  windows: SpeakerActivityWindow[],
  speaker: SpeakerActivityWindow['speaker'],
): number =>
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
  localDiarization?: {
    applied: boolean;
    multipleSpeakers: boolean;
    confidence: number;
    clusterCount: number;
    labeledSegmentCount: number;
  };
}): {
  accepted: boolean;
  segments: T[];
  attribution: StoredTranscriptSpeakerAttribution;
  reasons:
    | ['low_attribution_confidence']
    | ['low_speaker_separation_confidence']
    | [];
} => {
  if (input.localDiarization?.multipleSpeakers) {
    const accepted =
      input.localDiarization.applied &&
      input.localDiarization.confidence >= MINIMUM_ATTRIBUTION_CONFIDENCE;
    return {
      accepted,
      segments: input.segments.map((segment) =>
        segment.speaker === 'Me'
          ? ({ ...segment, speaker: 'Unknown' } as T)
          : ({ ...segment } as T),
      ),
      reasons: accepted ? [] : ['low_speaker_separation_confidence'],
      attribution: {
        source: 'recovered_channel_acoustic_v3',
        confidence: input.localDiarization.confidence,
        diarizationAttempted: true,
        mappingApplied: false,
        ...(accepted ? {} : { fallbackReason: 'low_confidence' as const }),
        nearEndEvidenceAttempted: true,
        speakerSeparation: accepted ? 'verified' : 'unresolved',
        selfIdentity: 'unresolved',
        localDiarization: {
          attempted: true,
          input: 'mic_audio',
          applied: input.localDiarization.applied,
          confidence: input.localDiarization.confidence,
          clusterCount: input.localDiarization.clusterCount,
          labeledSegmentCount: input.localDiarization.labeledSegmentCount,
        },
        engineVersion: `${input.provenance.runtimeVersion}@${input.provenance.modelRevision}`,
        modelChecksums: [input.provenance.artifactDigest],
      },
    };
  }
  const systemSegments = input.segments.filter(
    (segment) => segment.speaker === 'Them',
  );
  const segments = input.segments.map((segment) => {
    if (segment.speaker !== 'Me') {
      return { ...segment } as T;
    }
    const duration = Math.max(0.01, segment.endTime - segment.startTime);
    const concurrentSystemSeconds = systemSegments.reduce(
      (total, systemSegment) =>
        total +
        Math.max(
          0,
          Math.min(segment.endTime, systemSegment.endTime) -
            Math.max(segment.startTime, systemSegment.startTime),
        ),
      0,
    );
    if (
      concurrentSystemSeconds / duration < MINIMUM_CONCURRENT_SYSTEM_COVERAGE ||
      activitySeconds(segment, input.activityWindows, 'Me') / duration >=
        MINIMUM_LOCAL_COVERAGE
    ) {
      return { ...segment, speaker: 'Me', nearEndEvidence: true } as T;
    }
    return { ...segment, speaker: 'Unknown' } as T;
  });
  const totalSeconds = segments.reduce(
    (total, segment) =>
      total + Math.max(0, segment.endTime - segment.startTime),
    0,
  );
  const attributedSeconds = segments.reduce(
    (total, segment) =>
      total +
      (segment.speaker === 'Unknown'
        ? 0
        : Math.max(0, segment.endTime - segment.startTime)),
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
  };
};
