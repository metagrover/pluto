import type { CanonicalVoiceProfile, SpeakerVoiceRejection } from '../electron/speakerVoiceStore.ts';
import type { SpeakerCandidateEvidence } from '../src/services/speakerCandidateEvidence.ts';
import {
  DEFAULT_CALIBRATION_POLICY_V1,
  type VoiceProfileCalibrationPolicy,
  matchSpeakerVoice,
} from '../src/services/speakerVoiceMatcher.ts';

export interface VoiceCalibrationBenchmarkReport {
  schemaVersion: 1;
  policyVersion: string;
  compatibilityKey: string;
  totalCases: number;
  enrolledSpeakerCount: number;
  caseTaxonomy: {
    exactMatches: number;
    differentSpeakers: number;
    ambiguousRunnerUps: number;
    degradedDurations: number;
    degradedChunkSimilarities: number;
    incompatibleProvenances: number;
    calendarPresenceNotOverridingMargins: number;
    disabledProfiles: number;
    rejectionSuppression: number;
  };
  metrics: {
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    falseSuggestionRate: number;
    zeroFalseSuggestionsObserved: boolean;
  };
  selectedPolicyPassed: boolean;
}

export interface SyntheticBenchmarkCase {
  taxonomyCategory: keyof VoiceCalibrationBenchmarkReport['caseTaxonomy'];
  candidate: SpeakerCandidateEvidence;
  profiles: CanonicalVoiceProfile[];
  calendarAttendeePersonIds?: string[];
  rejections?: SpeakerVoiceRejection[];
  expectedMatchPersonId: string | null;
}

function normalizeVector(v: number[]): number[] {
  const norm = Math.hypot(...v);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

function createSyntheticUnitVector(dim: number): number[] {
  const v = new Array(256).fill(0);
  v[dim % 256] = 1.0;
  return v;
}

function blendVectors(v1: number[], v2: number[], weightV2: number): number[] {
  const blended = v1.map((val, i) => val * (1 - weightV2) + (v2[i] ?? 0) * weightV2);
  return normalizeVector(blended);
}

export function buildSyntheticCalibrationDataset(
  policy: VoiceProfileCalibrationPolicy = DEFAULT_CALIBRATION_POLICY_V1,
): {
  enrolledProfiles: CanonicalVoiceProfile[];
  cases: SyntheticBenchmarkCase[];
} {
  const vAlex = createSyntheticUnitVector(10);
  const vBob = createSyntheticUnitVector(50);
  const vCharlie = createSyntheticUnitVector(100);

  const standardProvenance = {
    modelIdentifier: policy.compatibilityKey.modelIdentifier,
    modelRevision: policy.compatibilityKey.modelRevision,
    artifactDigest: policy.compatibilityKey.artifactDigest,
    runtimeVersion: policy.compatibilityKey.runtimeVersion,
    profileAlgorithmVersion: policy.compatibilityKey.profileAlgorithmVersion,
  };

  const alexProfile: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-synthetic-alex',
    personName: 'Alex Synthetic',
    sampleCount: 3,
    cleanDurationSeconds: 15.0,
    embedding: vAlex,
    isActive: true,
    provenance: standardProvenance,
  };

  const bobProfile: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-synthetic-bob',
    personName: 'Bob Synthetic',
    sampleCount: 2,
    cleanDurationSeconds: 10.0,
    embedding: vBob,
    isActive: true,
    provenance: standardProvenance,
  };

  const charlieDisabledProfile: CanonicalVoiceProfile = {
    canonicalPersonId: 'person-synthetic-charlie',
    personName: 'Charlie Synthetic',
    sampleCount: 2,
    cleanDurationSeconds: 8.0,
    embedding: vCharlie,
    isActive: false, // disabled
    provenance: standardProvenance,
  };

  const allProfiles = [alexProfile, bobProfile, charlieDisabledProfile];

  const cases: SyntheticBenchmarkCase[] = [];

  // 1. exact_match: highly similar candidate (cosine similarity ~0.98), clean duration 5s, chunk sim 0.85
  const alexCloseVector = blendVectors(vAlex, createSyntheticUnitVector(11), 0.05);
  cases.push({
    taxonomyCategory: 'exactMatches',
    candidate: {
      speaker: 'Remote Speaker 1',
      nativeCluster: 'cluster_1',
      candidateDigest: 'cand-alex-1',
      embedding: alexCloseVector,
      cleanDurationSeconds: 5.0,
      cleanSegmentCount: 3,
      cleanChunkCount: 4,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.90,
      sampleInterval: { startTime: 0, endTime: 5 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: 'person-synthetic-alex',
  });

  // 2. different_speaker: orthogonal candidate (cosine similarity ~0.0)
  cases.push({
    taxonomyCategory: 'differentSpeakers',
    candidate: {
      speaker: 'Remote Speaker 2',
      nativeCluster: 'cluster_2',
      candidateDigest: 'cand-unknown-1',
      embedding: createSyntheticUnitVector(200),
      cleanDurationSeconds: 6.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.88,
      meanChunkSimilarity: 0.92,
      sampleInterval: { startTime: 0, endTime: 6 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 3. ambiguous_runner_up: similarity ~0.85 to Alex and ~0.80 to Bob (margin ~0.05 < 0.10)
  // vAmbiguous has projection ~0.72 on vAlex and ~0.68 on vBob
  const vAmbiguous = normalizeVector(
    alexProfile.embedding.map((a, i) => a * 0.72 + bobProfile.embedding[i] * 0.68),
  );
  cases.push({
    taxonomyCategory: 'ambiguousRunnerUps',
    candidate: {
      speaker: 'Remote Speaker 3',
      nativeCluster: 'cluster_3',
      candidateDigest: 'cand-ambiguous-1',
      embedding: vAmbiguous,
      cleanDurationSeconds: 4.5,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.82,
      meanChunkSimilarity: 0.88,
      sampleInterval: { startTime: 0, endTime: 4.5 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 4. degraded_duration: high similarity (0.98) but speech duration is 2.0s (< 3.0s)
  cases.push({
    taxonomyCategory: 'degradedDurations',
    candidate: {
      speaker: 'Remote Speaker 4',
      nativeCluster: 'cluster_4',
      candidateDigest: 'cand-short-1',
      embedding: alexCloseVector,
      cleanDurationSeconds: 2.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 2,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.90,
      sampleInterval: { startTime: 0, endTime: 2.0 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 5. degraded_chunk_similarity: high similarity (0.98) but minimum chunk similarity is 0.55 (< 0.70)
  cases.push({
    taxonomyCategory: 'degradedChunkSimilarities',
    candidate: {
      speaker: 'Remote Speaker 5',
      nativeCluster: 'cluster_5',
      candidateDigest: 'cand-impure-1',
      embedding: alexCloseVector,
      cleanDurationSeconds: 5.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.55,
      meanChunkSimilarity: 0.72,
      sampleInterval: { startTime: 0, endTime: 5.0 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 6. incompatible_provenance: high similarity (0.98) but different model identifier
  cases.push({
    taxonomyCategory: 'incompatibleProvenances',
    candidate: {
      speaker: 'Remote Speaker 6',
      nativeCluster: 'cluster_6',
      candidateDigest: 'cand-incompatible-1',
      embedding: alexCloseVector,
      cleanDurationSeconds: 5.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.90,
      sampleInterval: { startTime: 0, endTime: 5.0 },
      provenance: {
        modelIdentifier: 'titanet-large',
        modelRevision: 'v1',
        artifactDigest: 'titanet-digest',
        runtimeVersion: '1.0.0',
      },
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 7. calendar_presence_not_overriding_margin: calendar attendee Bob is close to Alex (margin 0.05)
  // Attendance must not bypass runner-up margin
  cases.push({
    taxonomyCategory: 'calendarPresenceNotOverridingMargins',
    candidate: {
      speaker: 'Remote Speaker 7',
      nativeCluster: 'cluster_7',
      candidateDigest: 'cand-calendar-ambig-1',
      embedding: vAmbiguous,
      cleanDurationSeconds: 4.5,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.82,
      meanChunkSimilarity: 0.88,
      sampleInterval: { startTime: 0, endTime: 4.5 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    calendarAttendeePersonIds: ['person-synthetic-bob'],
    expectedMatchPersonId: null,
  });

  // 8. disabled_profile: candidate matches Charlie (similarity ~0.98), but Charlie's profile is disabled
  cases.push({
    taxonomyCategory: 'disabledProfiles',
    candidate: {
      speaker: 'Remote Speaker 8',
      nativeCluster: 'cluster_8',
      candidateDigest: 'cand-charlie-1',
      embedding: vCharlie,
      cleanDurationSeconds: 4.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 2,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.90,
      sampleInterval: { startTime: 0, endTime: 4.0 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    expectedMatchPersonId: null,
  });

  // 9. rejection_suppression: candidate matches Alex, but this exact digest was previously rejected
  cases.push({
    taxonomyCategory: 'rejectionSuppression',
    candidate: {
      speaker: 'Remote Speaker 9',
      nativeCluster: 'cluster_9',
      candidateDigest: 'cand-rejected-digest-9',
      embedding: alexCloseVector,
      cleanDurationSeconds: 5.0,
      cleanSegmentCount: 2,
      cleanChunkCount: 3,
      minimumChunkSimilarity: 0.85,
      meanChunkSimilarity: 0.90,
      sampleInterval: { startTime: 0, endTime: 5.0 },
      provenance: standardProvenance,
    },
    profiles: allProfiles,
    rejections: [
      {
        meetingId: 'm-any',
        speaker: 'Remote Speaker 9',
        sourceRevision: 'gen-1',
        candidateDigest: 'cand-rejected-digest-9',
        personId: 'person-synthetic-alex',
        createdAt: new Date().toISOString(),
      },
    ],
    expectedMatchPersonId: null,
  });

  return {
    enrolledProfiles: allProfiles,
    cases,
  };
}

export function runCalibrationBenchmark(
  policy: VoiceProfileCalibrationPolicy = DEFAULT_CALIBRATION_POLICY_V1,
): VoiceCalibrationBenchmarkReport {
  const dataset = buildSyntheticCalibrationDataset(policy);

  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const taxonomyCounts: VoiceCalibrationBenchmarkReport['caseTaxonomy'] = {
    exactMatches: 0,
    differentSpeakers: 0,
    ambiguousRunnerUps: 0,
    degradedDurations: 0,
    degradedChunkSimilarities: 0,
    incompatibleProvenances: 0,
    calendarPresenceNotOverridingMargins: 0,
    disabledProfiles: 0,
    rejectionSuppression: 0,
  };

  for (const c of dataset.cases) {
    taxonomyCounts[c.taxonomyCategory] += 1;

    const match = matchSpeakerVoice({
      meetingId: 'm-any',
      sourceRevision: 'gen-1',
      candidate: c.candidate,
      profiles: c.profiles,
      calendarAttendeePersonIds: c.calendarAttendeePersonIds,
      rejections: c.rejections ?? [],
      options: {
        policy,
        featureFlagEnabled: true,
      },
    });

    const matchedPersonId = match?.suggestedPersonId ?? null;

    if (c.expectedMatchPersonId !== null) {
      if (matchedPersonId === c.expectedMatchPersonId) {
        truePositives += 1;
      } else if (matchedPersonId === null) {
        falseNegatives += 1;
      } else {
        // Suggested wrong person
        falsePositives += 1;
      }
    } else {
      if (matchedPersonId === null) {
        trueNegatives += 1;
      } else {
        // Suggested when should be null
        falsePositives += 1;
      }
    }
  }

  const totalCases = dataset.cases.length;
  const falseSuggestionRate = totalCases > 0 ? falsePositives / totalCases : 0.0;
  const zeroFalseSuggestionsObserved = falsePositives === 0;
  const selectedPolicyPassed = zeroFalseSuggestionsObserved && truePositives > 0;

  const report: VoiceCalibrationBenchmarkReport = {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    compatibilityKey: policy.compatibilityKey,
    totalCases,
    enrolledSpeakerCount: dataset.enrolledProfiles.length,
    caseTaxonomy: taxonomyCounts,
    metrics: {
      truePositives,
      trueNegatives,
      falsePositives,
      falseNegatives,
      falseSuggestionRate,
      zeroFalseSuggestionsObserved,
    },
    selectedPolicyPassed,
  };

  validateReportPrivacy(report);

  return report;
}

export function validateReportPrivacy(report: unknown): void {
  const json = JSON.stringify(report);

  const forbiddenKeys = [
    '"embedding"',
    '"candidateDigest"',
    '"digest"',
    '"sourceMeetingId"',
    '"meetingId"',
    '"referenceExcerpt"',
    '"excerpt"',
    '"audioPath"',
    '"audio_path"',
    '"rawScore"',
    '"similarityScore"',
  ];

  for (const key of forbiddenKeys) {
    if (json.includes(key)) {
      throw new Error(`privacy_violation_forbidden_key: ${key}`);
    }
  }

  // Check for any absolute filesystem paths or person names
  if (json.includes('/Users/') || json.includes('/home/') || json.includes('C:\\')) {
    throw new Error('privacy_violation_path_leakage');
  }

  if (json.includes('Alex') || json.includes('Bob') || json.includes('Charlie')) {
    throw new Error('privacy_violation_identity_leakage');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runCalibrationBenchmark();
  console.log(JSON.stringify(report, null, 2));
  if (!report.selectedPolicyPassed) {
    process.exit(1);
  }
}
