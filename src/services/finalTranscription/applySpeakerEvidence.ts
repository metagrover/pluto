import type {
  AlignedEnergyWindow,
  DiarizationTurn,
} from '../../utils/acousticSpeakerAttribution.ts';
import {
  deriveAttributionEvidence,
  injectLocalEvidenceWindows,
  mapDiarizationFromAcousticEvidence,
} from '../../utils/acousticSpeakerAttribution.ts';
import type { AttributionSegment } from '../../utils/speakerAttribution.ts';
import { splitSegmentsAtDiarizationBoundaries } from '../../utils/speakerAttribution.ts';
import type { StoredTranscriptSpeakerAttribution } from '../../utils/transcriptSchema.ts';
import { buildTranscriptSpeakerAttribution } from '../../utils/transcriptSchema.ts';

export type FinalSpeakerEvidence = {
  turns: DiarizationTurn[];
  energyWindows: AlignedEnergyWindow[];
  provenance: {
    modelIdentifier: string;
    modelRevision: string;
    artifactDigest: string;
    runtimeVersion: string;
  };
  timings: {
    diarizationMs: number;
    energyAnalysisMs: number;
    totalMs: number;
  };
  windowSeconds: number;
};

export type SpeakerEvidenceRejectionReason =
  | 'missing_mapped_speaker'
  | 'low_attribution_confidence'
  | 'false_me_evidence'
  | 'missed_me_evidence';

const MINIMUM_ATTRIBUTION_CONFIDENCE = 0.8;
const MAXIMUM_MISSED_ME_SECONDS = 0.25;
const MINIMUM_SEGMENT_COVERAGE = 0.5;

const overlapSeconds = (
  left: { startTime: number; endTime: number },
  right: { startTime: number; endTime: number },
): number =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

export const applySpeakerEvidence = <T extends AttributionSegment>(input: {
  segments: T[];
  evidence: FinalSpeakerEvidence;
}): {
  accepted: boolean;
  segments: T[];
  attribution: StoredTranscriptSpeakerAttribution;
  reasons: SpeakerEvidenceRejectionReason[];
} => {
  const evidenceWindows = deriveAttributionEvidence(
    input.evidence.energyWindows,
  );
  const mapped = mapDiarizationFromAcousticEvidence({
    turns: input.evidence.turns,
    evidenceWindows,
  });
  const trustedMapping = Object.fromEntries(
    Object.entries(mapped.mapping).filter(
      (entry): entry is [string, 'Me' | 'Them'] =>
        entry[1] === 'Me' || entry[1] === 'Them',
    ),
  );
  const diarizationSegments = input.evidence.turns.map((turn) => ({
    startTime: turn.startTime,
    endTime: turn.endTime,
    speaker: turn.cluster,
    text: '',
  }));
  const boundarySplit = splitSegmentsAtDiarizationBoundaries(
    input.segments,
    diarizationSegments,
    trustedMapping,
  );

  const aligned = boundarySplit.segments.map((segment) => {
    const duration = Math.max(0.01, segment.endTime - segment.startTime);
    let bestTurn: DiarizationTurn | undefined;
    let bestOverlap = 0;
    for (const turn of input.evidence.turns) {
      const overlap = overlapSeconds(segment, turn);
      if (overlap > bestOverlap) {
        bestTurn = turn;
        bestOverlap = overlap;
      }
    }
    if (!bestTurn || bestOverlap / duration < MINIMUM_SEGMENT_COVERAGE) {
      return { segment: { ...segment }, unsupported: true };
    }
    return {
      segment: {
        ...segment,
        speaker: trustedMapping[bestTurn.cluster] ?? 'Unknown',
      },
      unsupported: false,
    };
  });

  const injected = injectLocalEvidenceWindows(
    aligned.map((entry) => entry.segment),
    mapped.injectedLocalWindows,
  );
  const segments = injected.map((segment, index) => {
    const wasUnsupported = aligned[index]?.unsupported === true;
    const wasInjected =
      wasUnsupported &&
      aligned[index]?.segment.speaker === 'Them' &&
      segment.speaker === 'Me';
    return wasUnsupported && !wasInjected
      ? ({ ...segment, speaker: 'Unknown' } as T)
      : segment;
  });

  const reasons: SpeakerEvidenceRejectionReason[] = [];
  if (Object.keys(trustedMapping).length === 0) {
    reasons.push('missing_mapped_speaker');
  }
  if (mapped.confidence < MINIMUM_ATTRIBUTION_CONFIDENCE) {
    reasons.push('low_attribution_confidence');
  }
  if (mapped.falseMeEvidenceSeconds > 0) {
    reasons.push('false_me_evidence');
  }
  if (mapped.missedMeEvidenceSeconds > MAXIMUM_MISSED_ME_SECONDS) {
    reasons.push('missed_me_evidence');
  }
  const accepted = reasons.length === 0;
  const attribution = accepted
    ? ({
        source: 'offline_diarization_acoustic_v1',
        confidence: mapped.confidence,
        diarizationAttempted: true,
        mappingApplied: true,
        nearEndEvidenceAttempted: true,
        engineVersion: `${input.evidence.provenance.runtimeVersion}@${input.evidence.provenance.modelRevision}`,
        modelChecksums: [input.evidence.provenance.artifactDigest],
        injectedLocalWindows: mapped.injectedLocalWindows.length,
        falseMeEvidenceSeconds: mapped.falseMeEvidenceSeconds,
        missedMeEvidenceSeconds: mapped.missedMeEvidenceSeconds,
      } satisfies StoredTranscriptSpeakerAttribution)
    : buildTranscriptSpeakerAttribution({
        diarizationEnabled: true,
        diarizationAttempted: true,
        mappingApplied: false,
        confidence: mapped.confidence,
        fallbackReason:
          mapped.fallbackReason ??
          (reasons.includes('low_attribution_confidence')
            ? 'low_confidence'
            : 'unknown_diarization_fallback'),
        acousticEvidenceAttempted: true,
        engineVersion: `${input.evidence.provenance.runtimeVersion}@${input.evidence.provenance.modelRevision}`,
        modelChecksums: [input.evidence.provenance.artifactDigest],
        injectedLocalWindows: 0,
        falseMeEvidenceSeconds: mapped.falseMeEvidenceSeconds,
        missedMeEvidenceSeconds: mapped.missedMeEvidenceSeconds,
      });

  return { accepted, segments, attribution, reasons };
};
