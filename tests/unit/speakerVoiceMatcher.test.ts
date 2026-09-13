import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalVoiceProfile,
  SpeakerVoiceRejection,
} from '../../electron/speakerVoiceStore';
import type { SpeakerCandidateEvidence } from '../../src/services/speakerCandidateEvidence';
import {
  DEFAULT_CALIBRATION_POLICY_V1,
  type VoiceProfileCalibrationPolicy,
  matchSpeakerVoice,
  matchSpeakerVoiceOutcome,
} from '../../src/services/speakerVoiceMatcher';

describe('speakerVoiceMatcher & global acoustic calibration', () => {
  it('keeps the matching policy aligned with native speaker evidence provenance', () => {
    const nativeRuntime = fs.readFileSync(
      'native/parakeet-runtime/Sources/ParakeetRuntimeEngine/FluidAudioEngine.swift',
      'utf8',
    );
    const nativeService = fs.readFileSync(
      'native/parakeet-runtime/Sources/ParakeetRuntimeEngine/ParakeetService.swift',
      'utf8',
    );
    const key = DEFAULT_CALIBRATION_POLICY_V1.compatibilityKey;

    expect(nativeRuntime).toContain(`identifier: "${key.modelIdentifier}"`);
    expect(nativeRuntime).toContain(`revision: "${key.modelRevision}"`);
    expect(nativeRuntime).toContain(`artifactSHA256: "${key.artifactDigest}"`);
    expect(nativeService).toContain(`runtimeVersion: "${key.runtimeVersion}"`);
  });

  const dummyPolicy: VoiceProfileCalibrationPolicy = {
    ...DEFAULT_CALIBRATION_POLICY_V1,
    compatibilityKey: {
      modelIdentifier: 'test-diarizer',
      modelRevision: 'rev-test',
      artifactDigest: 'art-test',
      runtimeVersion: 'run-test',
      profileAlgorithmVersion: 'v1',
    },
    minAbsoluteSimilarity: 0.72,
    minRunnerUpMargin: 0.1,
    enabled: true,
  };

  const createVector = (dominantIndex: number): number[] => {
    const v = new Array(256).fill(0);
    v[dominantIndex] = 1.0;
    return v;
  };

  const validCandidate: SpeakerCandidateEvidence = {
    speaker: 'Remote Speaker 1',
    nativeCluster: 'S1',
    candidateDigest: 'cand-digest-1',
    embedding: createVector(0),
    cleanDurationSeconds: 5.0,
    cleanSegmentCount: 3,
    cleanChunkCount: 4,
    minimumChunkSimilarity: 0.85,
    meanChunkSimilarity: 0.9,
    referenceInterval: {
      startTime: 1.0,
      endTime: 4.0,
      excerpt: 'valid candidate excerpt',
    },
    provenance: {
      modelIdentifier: 'test-diarizer',
      modelRevision: 'rev-test',
      artifactDigest: 'art-test',
      runtimeVersion: 'run-test',
      profileAlgorithmVersion: 'v1',
    },
    isEligibleForEnrollment: true,
  };

  const profileAlex: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-alex',
    personName: 'Alex Smith',
    sampleCount: 2,
    cleanDurationSeconds: 8.0,
    isActive: true,
    embedding: createVector(0), // exact match with candidate -> similarity 1.0
    referenceInterval: {
      startTime: 2.0,
      endTime: 5.0,
      excerpt: 'Alex reference speech',
      sourceMeetingId: 'm-alex',
    },
    provenance: { ...validCandidate.provenance },
  };

  const profileBob: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-bob',
    personName: 'Bob Jones',
    sampleCount: 1,
    cleanDurationSeconds: 4.0,
    isActive: true,
    embedding: createVector(1), // orthogonal -> similarity 0.0
    referenceInterval: {
      startTime: 1.0,
      endTime: 3.0,
      excerpt: 'Bob reference speech',
      sourceMeetingId: 'm-bob',
    },
    provenance: { ...validCandidate.provenance },
  };

  it('returns null when feature flag is disabled', () => {
    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex, profileBob],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: false },
    });

    expect(result).toBeNull();
  });

  it('returns winning match when candidate satisfies absolute threshold and margin', () => {
    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex, profileBob],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result).not.toBeNull();
    expect(result?.suggestedPersonId).toBe('person-alex');
    expect(result?.suggestedPersonName).toBe('Alex Smith');
    expect(result?.similarityScore).toBeCloseTo(1.0);
    expect(result?.confidenceTier).toBe('strong');
    expect(result?.isCalendarAttendee).toBe(false);
    expect(result?.candidateDigest).toBe('cand-digest-1');
  });

  it('reports why an otherwise valid candidate was not suggested', () => {
    expect(
      matchSpeakerVoiceOutcome({
        meetingId: 'm1',
        sourceRevision: 'gen-1',
        candidate: validCandidate,
        profiles: [],
        rejections: [],
        options: { policy: dummyPolicy, featureFlagEnabled: true },
      }),
    ).toEqual({ category: 'no_profile' });

    expect(
      matchSpeakerVoiceOutcome({
        meetingId: 'm1',
        sourceRevision: 'gen-1',
        candidate: validCandidate,
        profiles: [{ ...profileAlex, isActive: false }],
        rejections: [],
        options: { policy: dummyPolicy, featureFlagEnabled: true },
      }),
    ).toEqual({ category: 'no_profile' });

    const lowSimilarityProfile = {
      ...profileAlex,
      embedding: createVector(8),
    };
    expect(
      matchSpeakerVoiceOutcome({
        meetingId: 'm1',
        sourceRevision: 'gen-1',
        candidate: validCandidate,
        profiles: [lowSimilarityProfile],
        rejections: [],
        options: { policy: dummyPolicy, featureFlagEnabled: true },
      }),
    ).toEqual({ category: 'below_threshold' });
  });

  it('rejects candidate when purity gate fails (< 3.0s clean duration)', () => {
    const impureCandidate: SpeakerCandidateEvidence = {
      ...validCandidate,
      cleanDurationSeconds: 2.5,
      isEligibleForEnrollment: false,
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: impureCandidate,
      profiles: [profileAlex],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result).toBeNull();
  });

  it('rejects candidate when provenance is incompatible with calibration policy', () => {
    const incompatibleCandidate: SpeakerCandidateEvidence = {
      ...validCandidate,
      provenance: {
        ...validCandidate.provenance,
        runtimeVersion: 'incompatible-runtime',
      },
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: incompatibleCandidate,
      profiles: [profileAlex],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result).toBeNull();
  });

  it('excludes person when rejection exists for exact candidate digest', () => {
    const rejection: SpeakerVoiceRejection = {
      meetingId: 'm1',
      speaker: 'Remote Speaker 1',
      sourceRevision: 'gen-1',
      candidateDigest: 'cand-digest-1',
      personId: 'person-alex',
      createdAt: new Date().toISOString(),
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex, profileBob],
      rejections: [rejection],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    // Alex was rejected, Bob has similarity 0.0 which is below threshold 0.72
    expect(result).toBeNull();
  });

  it('does not suppress suggestion if rejection was for a different candidate digest', () => {
    const rejectionDifferentDigest: SpeakerVoiceRejection = {
      meetingId: 'm1',
      speaker: 'Remote Speaker 1',
      sourceRevision: 'gen-1',
      candidateDigest: 'different-digest',
      personId: 'person-alex',
      createdAt: new Date().toISOString(),
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex],
      rejections: [rejectionDifferentDigest],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result?.suggestedPersonId).toBe('person-alex');
  });

  it('suppresses suggestion when similarity is below absolute threshold', () => {
    // Vector with 0.70 similarity
    const angle = Math.acos(0.7);
    const lowSimVector = new Array(256).fill(0);
    lowSimVector[0] = Math.cos(angle);
    lowSimVector[1] = Math.sin(angle);

    const lowSimProfile: CanonicalVoiceProfile = {
      ...profileAlex,
      embedding: lowSimVector,
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [lowSimProfile],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result).toBeNull();
  });

  it('uses two independently retained profile representatives when the centroid is unstable', () => {
    const candidate = {
      ...validCandidate,
      embedding: createVector(5),
      representativeEmbeddings: [createVector(0), createVector(4)],
    };
    const profile = {
      ...profileAlex,
      embedding: createVector(6),
      representativeEmbeddings: [createVector(0), createVector(0)],
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate,
      profiles: [profile],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(result?.suggestedPersonId).toBe(profile.canonicalPersonId);
    expect(result?.similarityScore).toBe(1);
  });

  it('does not let one profile representative bypass the calibrated threshold', () => {
    const candidate = {
      ...validCandidate,
      embedding: createVector(5),
      representativeEmbeddings: [createVector(0)],
    };
    const profile = {
      ...profileAlex,
      embedding: createVector(6),
      representativeEmbeddings: [createVector(0)],
    };

    expect(
      matchSpeakerVoice({
        meetingId: 'm1',
        sourceRevision: 'gen-1',
        candidate,
        profiles: [profile],
        rejections: [],
        options: { policy: dummyPolicy, featureFlagEnabled: true },
      }),
    ).toBeNull();
  });

  it('suppresses suggestion when margin between top 2 is below runner-up margin (0.10)', () => {
    // Top candidate similarity 0.85
    const angle1 = Math.acos(0.85);
    const v1 = new Array(256).fill(0);
    v1[0] = Math.cos(angle1);
    v1[1] = Math.sin(angle1);

    // Runner-up similarity 0.80 (diff = 0.05 < 0.10)
    const angle2 = Math.acos(0.8);
    const v2 = new Array(256).fill(0);
    v2[0] = Math.cos(angle2);
    v2[2] = Math.sin(angle2);

    const p1: CanonicalVoiceProfile = {
      ...profileAlex,
      canonicalPersonId: 'person-1',
      embedding: v1,
    };
    const p2: CanonicalVoiceProfile = {
      ...profileBob,
      canonicalPersonId: 'person-2',
      embedding: v2,
    };

    const result = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [p1, p2],
      rejections: [],
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    // Ambiguous -> suppressed
    expect(result).toBeNull();
  });

  it('annotates calendar attendance without altering scores or acoustic ranking', () => {
    const resultWithCalendar = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex, profileBob],
      rejections: [],
      calendarAttendeePersonIds: new Set(['person-alex']),
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(resultWithCalendar?.suggestedPersonId).toBe('person-alex');
    expect(resultWithCalendar?.isCalendarAttendee).toBe(true);

    // Even if Bob is on calendar, Alex still wins acoustically
    const resultBobOnCalendar = matchSpeakerVoice({
      meetingId: 'm1',
      sourceRevision: 'gen-1',
      candidate: validCandidate,
      profiles: [profileAlex, profileBob],
      rejections: [],
      calendarAttendeePersonIds: new Set(['person-bob']),
      options: { policy: dummyPolicy, featureFlagEnabled: true },
    });

    expect(resultBobOnCalendar?.suggestedPersonId).toBe('person-alex');
    expect(resultBobOnCalendar?.isCalendarAttendee).toBe(false);
  });
});
