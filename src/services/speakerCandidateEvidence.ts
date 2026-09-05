import { selectSpeakerSampleIntervals } from '../utils/speakerReview.ts';

export interface SpeakerClusterEvidence {
  cluster: string;
  embedding: number[];
  cleanChunkCount: number;
  cleanSegmentCount: number;
  cleanDurationSeconds: number;
  minimumChunkSimilarity: number;
  meanChunkSimilarity: number;
}

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

// Self-contained synchronous SHA-256 for browser/renderer & Node environments
const rightRotate = (n: number, x: number) => (x >>> n) | (x << (32 - n));
const maxWord = 2 ** 32;
const sha256InitialHash: number[] = [];
const sha256Constants: number[] = [];
let primeCounter = 0;
const composite: Record<number, boolean> = {};
for (let candidate = 2; primeCounter < 64; candidate += 1) {
  if (composite[candidate]) continue;
  for (
    let multiple = candidate * candidate;
    multiple < 313;
    multiple += candidate
  ) {
    composite[multiple] = true;
  }
  if (primeCounter < 8) {
    sha256InitialHash[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
  }
  sha256Constants[primeCounter] = (candidate ** (1 / 3) * maxWord) | 0;
  primeCounter += 1;
}

export function sha256Bytes(bytes: Uint8Array): string {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words.push(bytes[i]);
  words.push(0x80);
  while (words.length % 64 !== 56) words.push(0);
  const bitLength = bytes.length * 8;
  for (let shift = 56; shift >= 0; shift -= 8) {
    words.push(shift >= 32 ? 0 : (bitLength >>> shift) & 0xff);
  }
  const hash = [...sha256InitialHash];
  for (let offset = 0; offset < words.length; offset += 64) {
    const schedule = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      schedule[index] =
        (words[at] << 24) |
        (words[at + 1] << 16) |
        (words[at + 2] << 8) |
        words[at + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      const s0 = rightRotate(7, a) ^ rightRotate(18, a) ^ (a >>> 3);
      const s1 = rightRotate(17, b) ^ rightRotate(19, b) ^ (b >>> 10);
      schedule[index] =
        (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(6, e) ^ rightRotate(11, e) ^ rightRotate(25, e);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + sha256Constants[index] + schedule[index]) | 0;
      const sum0 = rightRotate(2, a) ^ rightRotate(13, a) ^ rightRotate(22, a);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function computeCandidateDigest(
  embedding: number[],
  provenance: SpeakerCandidateProvenance,
): string {
  const floatBytes = new Uint8Array(embedding.length * 4);
  const view = new DataView(floatBytes.buffer);
  for (let i = 0; i < embedding.length; i++) {
    view.setFloat32(i * 4, embedding[i], true);
  }
  const provenanceTuple = `${provenance.modelIdentifier}:${provenance.modelRevision}:${provenance.artifactDigest}:${provenance.runtimeVersion}:${provenance.profileAlgorithmVersion ?? 'v1'}`;
  const provenanceBytes = new TextEncoder().encode(provenanceTuple);
  const totalBytes = new Uint8Array(floatBytes.length + provenanceBytes.length);
  totalBytes.set(floatBytes, 0);
  totalBytes.set(provenanceBytes, floatBytes.length);
  return sha256Bytes(totalBytes);
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
