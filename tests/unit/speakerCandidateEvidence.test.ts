import { describe, expect, it } from 'vitest';
import type { SpeakerClusterEvidence } from '../../electron/transcription/parakeetFinalClient';
import {
  computeCandidateDigest,
  deriveReviewedSpeakerCandidate,
  deriveSpeakerCandidates,
} from '../../src/services/speakerCandidateEvidence';

describe('speakerCandidateEvidence', () => {
  const dummyProvenance = {
    modelIdentifier: 'speaker-diarization-offline-v1',
    modelRevision: 'a'.repeat(40),
    artifactDigest: 'b'.repeat(64),
    runtimeVersion: 'fluidaudio-test',
    profileAlgorithmVersion: 'v1',
  };

  const validEmbedding = new Array(256).fill(1 / 16);

  it('computes deterministic canonical candidate digest from little-endian float32 bytes and provenance', () => {
    const digest1 = computeCandidateDigest(validEmbedding, dummyProvenance);
    const digest2 = computeCandidateDigest(validEmbedding, dummyProvenance);
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);

    // Changing algorithm version changes digest
    const digestDiffVersion = computeCandidateDigest(validEmbedding, {
      ...dummyProvenance,
      profileAlgorithmVersion: 'v2',
    });
    expect(digestDiffVersion).not.toBe(digest1);

    // Changing single float bit changes digest
    const slightlyDifferentEmbedding = [...validEmbedding];
    slightlyDifferentEmbedding[0] += 0.0001;
    const digestDiffEmbedding = computeCandidateDigest(
      slightlyDifferentEmbedding,
      dummyProvenance,
    );
    expect(digestDiffEmbedding).not.toBe(digest1);
  });

  it('determines enrollment eligibility based on purity gating criteria', () => {
    const clusterEligible: SpeakerClusterEvidence = {
      cluster: 'S1',
      embedding: validEmbedding,
      cleanChunkCount: 3,
      cleanSegmentCount: 2,
      cleanDurationSeconds: 4.5,
      minimumChunkSimilarity: 0.82,
      meanChunkSimilarity: 0.88,
    };

    const segments = [
      {
        speaker: 'Them',
        text: 'Hello world this is candidate speech',
        start: 0,
        end: 5,
        words: [
          { word: 'Hello', start: 0, end: 1 },
          { word: 'world', start: 1, end: 2 },
        ],
      },
    ];

    const candidates = deriveSpeakerCandidates({
      clusterEvidence: [clusterEligible],
      segments,
      establishedClusters: [{ cluster: 'S1', label: 'Them' }],
      provenance: dummyProvenance,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].isEligibleForEnrollment).toBe(true);
    expect(candidates[0].speaker).toBe('Them');
    expect(candidates[0].nativeCluster).toBe('S1');
    expect(candidates[0].candidateDigest).toHaveLength(64);

    // Ineligible: short duration (< 3.0s)
    const shortCandidates = deriveSpeakerCandidates({
      clusterEvidence: [{ ...clusterEligible, cleanDurationSeconds: 2.5 }],
      segments,
      establishedClusters: [{ cluster: 'S1', label: 'Them' }],
      provenance: dummyProvenance,
    });
    expect(shortCandidates[0].isEligibleForEnrollment).toBe(false);

    // Ineligible: fewer than 2 segments
    const oneSegCandidates = deriveSpeakerCandidates({
      clusterEvidence: [{ ...clusterEligible, cleanSegmentCount: 1 }],
      segments,
      establishedClusters: [{ cluster: 'S1', label: 'Them' }],
      provenance: dummyProvenance,
    });
    expect(oneSegCandidates[0].isEligibleForEnrollment).toBe(false);

    // Ineligible: fewer than 2 chunks
    const oneChunkCandidates = deriveSpeakerCandidates({
      clusterEvidence: [{ ...clusterEligible, cleanChunkCount: 1 }],
      segments,
      establishedClusters: [{ cluster: 'S1', label: 'Them' }],
      provenance: dummyProvenance,
    });
    expect(oneChunkCandidates[0].isEligibleForEnrollment).toBe(false);

    // Ineligible: low within-cluster similarity (< 0.70)
    const lowSimCandidates = deriveSpeakerCandidates({
      clusterEvidence: [{ ...clusterEligible, minimumChunkSimilarity: 0.65 }],
      segments,
      establishedClusters: [{ cluster: 'S1', label: 'Them' }],
      provenance: dummyProvenance,
    });
    expect(lowSimCandidates[0].isEligibleForEnrollment).toBe(false);
  });

  it('maps multi-speaker clusters to numbered Remote Speakers in chronological order', () => {
    const cluster1: SpeakerClusterEvidence = {
      cluster: 'S1',
      embedding: validEmbedding,
      cleanChunkCount: 3,
      cleanSegmentCount: 2,
      cleanDurationSeconds: 4.5,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.9,
    };
    const cluster2: SpeakerClusterEvidence = {
      cluster: 'S2',
      embedding: validEmbedding,
      cleanChunkCount: 2,
      cleanSegmentCount: 2,
      cleanDurationSeconds: 3.5,
      minimumChunkSimilarity: 0.75,
      meanChunkSimilarity: 0.8,
    };

    const segments = [
      {
        speaker: 'Remote Speaker 1',
        text: 'First person speaking',
        start: 0,
        end: 5,
        words: [{ word: 'First', start: 0, end: 1 }],
      },
      {
        speaker: 'Remote Speaker 2',
        text: 'Second person speaking',
        start: 6,
        end: 10,
        words: [{ word: 'Second', start: 6, end: 7 }],
      },
    ];

    const candidates = deriveSpeakerCandidates({
      clusterEvidence: [cluster1, cluster2],
      segments,
      establishedClusters: [
        { cluster: 'S1', label: 'Remote Speaker 1' },
        { cluster: 'S2', label: 'Remote Speaker 2' },
      ],
      provenance: dummyProvenance,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('derives one fail-closed enrollment candidate from two reviewed samples', () => {
    const strongEvidence: SpeakerClusterEvidence = {
      cluster: 'S1',
      embedding: validEmbedding,
      cleanChunkCount: 3,
      cleanSegmentCount: 2,
      cleanDurationSeconds: 8,
      minimumChunkSimilarity: 0.82,
      meanChunkSimilarity: 0.9,
    };
    const intervals = [
      { startSec: 10, endSec: 16, excerpt: 'First reviewed sample' },
      { startSec: 30, endSec: 34, excerpt: 'Second reviewed sample' },
    ];

    const candidate = deriveReviewedSpeakerCandidate({
      speaker: 'Them',
      clusterEvidence: [strongEvidence],
      provenance: dummyProvenance,
      reviewedIntervals: intervals,
    });

    expect(candidate).toMatchObject({
      speaker: 'Them',
      nativeCluster: 'S1',
      cleanSegmentCount: 2,
      isEligibleForEnrollment: true,
      referenceInterval: {
        startTime: intervals[0].startSec,
        endTime: intervals[0].endSec,
        excerpt: intervals[0].excerpt,
      },
    });
    expect(candidate?.candidateDigest).toHaveLength(64);

    const durationCapped = deriveReviewedSpeakerCandidate({
      speaker: 'Them',
      clusterEvidence: [{ ...strongEvidence, cleanDurationSeconds: 100 }],
      provenance: dummyProvenance,
      reviewedIntervals: intervals,
    });
    expect(durationCapped?.cleanDurationSeconds).toBe(10);

    expect(
      deriveReviewedSpeakerCandidate({
        speaker: 'Them',
        clusterEvidence: [strongEvidence],
        provenance: dummyProvenance,
        reviewedIntervals: intervals.slice(0, 1),
      }),
    ).toBeNull();
    expect(
      deriveReviewedSpeakerCandidate({
        speaker: 'Them',
        clusterEvidence: [strongEvidence, { ...strongEvidence, cluster: 'S2' }],
        provenance: dummyProvenance,
        reviewedIntervals: intervals,
      }),
    ).toBeNull();
    expect(
      deriveReviewedSpeakerCandidate({
        speaker: 'Them',
        clusterEvidence: [{ ...strongEvidence, minimumChunkSimilarity: 0.2 }],
        provenance: dummyProvenance,
        reviewedIntervals: intervals,
      }),
    ).toBeNull();
    expect(
      deriveReviewedSpeakerCandidate({
        speaker: 'Them',
        clusterEvidence: [{ ...strongEvidence, cleanSegmentCount: 1 }],
        provenance: dummyProvenance,
        reviewedIntervals: intervals,
      }),
    ).toBeNull();
  });
});
