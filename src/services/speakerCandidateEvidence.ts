import { createHash } from 'node:crypto';
import type { SpeakerClusterEvidence } from '../../electron/transcription/parakeetFinalClient.ts';
import { selectSpeakerSampleIntervals } from '../../src/utils/speakerReview.ts';

export interface SpeakerCandidateProvenance {
  modelIdentifier: string;
  modelRevision: string;
  artifactDigest: string;
  runtimeVersion: string;
  profileAlgorithmVersion?: string;
}

export interface SpeakerCandidateEvidence {
  speaker: string;
  nativeCluster: string;
  candidateDigest: string;
  embedding: number[];
  cleanDurationSeconds: number;
  cleanSegmentCount: number;
  cleanChunkCount: number;
  minimumChunkSimilarity: number;
  meanChunkSimilarity: number;
  referenceInterval: {
    startTime: number;
    endTime: number;
    excerpt: string;
  };
  provenance: SpeakerCandidateProvenance;
  isEligibleForEnrollment: boolean;
}

export const ENROLLMENT_PURITY_GATES = {
  minDurationSeconds: 3.0,
  minSegmentCount: 2,
  minChunkCount: 2,
  minWithinClusterSimilarity: 0.7,
} as const;

export function computeCandidateDigest(
  embedding: number[],
  provenance: SpeakerCandidateProvenance,
): string {
  const buffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  const provenanceTuple = `${provenance.modelIdentifier}:${provenance.modelRevision}:${provenance.artifactDigest}:${provenance.runtimeVersion}:${provenance.profileAlgorithmVersion ?? 'v1'}`;
  return createHash('sha256')
    .update(buffer)
    .update(Buffer.from(provenanceTuple, 'utf8'))
    .digest('hex');
}

export function isCandidateEligibleForEnrollment(evidence: {
  cleanDurationSeconds: number;
  cleanSegmentCount: number;
  cleanChunkCount: number;
  minimumChunkSimilarity: number;
}): boolean {
  return (
    evidence.cleanDurationSeconds >=
      ENROLLMENT_PURITY_GATES.minDurationSeconds &&
    evidence.cleanSegmentCount >= ENROLLMENT_PURITY_GATES.minSegmentCount &&
    evidence.cleanChunkCount >= ENROLLMENT_PURITY_GATES.minChunkCount &&
    evidence.minimumChunkSimilarity >=
      ENROLLMENT_PURITY_GATES.minWithinClusterSimilarity
  );
}

export function deriveSpeakerCandidates(input: {
  clusterEvidence: SpeakerClusterEvidence[];
  segments: Array<{
    speaker?: unknown;
    text?: unknown;
    start?: unknown;
    end?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    words?: Array<{
      word?: string;
      text?: string;
      start?: number;
      end?: number;
    }>;
  }>;
  establishedClusters: Array<{ cluster: string; label: string }>;
  provenance: SpeakerCandidateProvenance;
}): SpeakerCandidateEvidence[] {
  const clusterLabelMap = new Map(
    input.establishedClusters.map((entry) => [entry.cluster, entry.label]),
  );

  const candidates: SpeakerCandidateEvidence[] = [];

  for (const evidence of input.clusterEvidence) {
    const speakerLabel = clusterLabelMap.get(evidence.cluster);
    if (!speakerLabel) continue;

    const digest = computeCandidateDigest(evidence.embedding, input.provenance);
    const eligible = isCandidateEligibleForEnrollment(evidence);

    const samples = selectSpeakerSampleIntervals(
      input.segments,
      speakerLabel,
      1,
    );
    const bestSample = samples[0];

    const referenceInterval = bestSample
      ? {
          startTime: bestSample.startSec,
          endTime: bestSample.endSec,
          excerpt: bestSample.excerpt,
        }
      : {
          startTime: 0,
          endTime: Math.min(5, evidence.cleanDurationSeconds),
          excerpt: '',
        };

    candidates.push({
      speaker: speakerLabel,
      nativeCluster: evidence.cluster,
      candidateDigest: digest,
      embedding: evidence.embedding,
      cleanDurationSeconds: evidence.cleanDurationSeconds,
      cleanSegmentCount: evidence.cleanSegmentCount,
      cleanChunkCount: evidence.cleanChunkCount,
      minimumChunkSimilarity: evidence.minimumChunkSimilarity,
      meanChunkSimilarity: evidence.meanChunkSimilarity,
      referenceInterval,
      provenance: {
        ...input.provenance,
        profileAlgorithmVersion:
          input.provenance.profileAlgorithmVersion ?? 'v1',
      },
      isEligibleForEnrollment: eligible,
    });
  }

  return candidates;
}
