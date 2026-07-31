export type TranscriptSource = 'mic' | 'system';

export type IntervalSourceDisposition =
  | { disposition: 'captured'; checksumSha256: string }
  | { disposition: 'verified_silence' }
  | { disposition: 'source_unavailable'; reason: string }
  | { disposition: 'missing'; reason: string }
  | { disposition: 'conversion_failed'; reason: string };

export interface TranscriptInterval {
  sequence: number;
  start: number;
  end: number;
  sources: Record<TranscriptSource, IntervalSourceDisposition>;
}

export interface CheckpointReference {
  source: TranscriptSource;
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfigKey: string;
  transcriptChecksumSha256: string;
  revision: number;
  disposition:
    | 'transcribed'
    | 'verified_silence'
    | 'conversion_failed'
    | 'transcription_failed'
    | 'cancelled';
}

export interface CheckpointSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

export interface TranscriptCheckpointCandidate {
  reference: CheckpointReference;
  evidence: {
    audioChecksumVerified: boolean;
    sidecarChecksumVerified: boolean;
    pathSafe: boolean;
  };
  sidecar: {
    schemaVersion: number;
    meetingId: string;
    source: TranscriptSource;
    sequence: number;
    chunkChecksumSha256: string;
    chunkStartSec: number;
    chunkEndSec: number;
    transcriptionConfigKey: string;
    segments: CheckpointSegment[];
  };
  repairAttempted?: boolean;
}

export interface TranscriptAcceptanceFrame {
  sequence: number;
  micCheckpointChecksumSha256: string | null;
  systemCheckpointChecksumSha256: string | null;
  arbitrationVersion: string;
  activityEvidenceDigestSha256: string;
  evidenceMatches: boolean;
  segments: Array<
    CheckpointSegment & {
      source: TranscriptSource;
    }
  >;
}

export interface TranscriptFinalizationInput {
  meetingId: string;
  expectedConfigKey: string;
  intervals: TranscriptInterval[];
  checkpoints: TranscriptCheckpointCandidate[];
  acceptanceFrames: TranscriptAcceptanceFrame[];
  arbitrationVersion: 'chunk_arbitration_v1';
  speechActivity: Array<{
    source: TranscriptSource;
    sequence: number;
    speechDetected: boolean;
  }>;
}

export type CheckpointRepairReason =
  | 'checkpoint_missing'
  | 'checkpoint_corrupt'
  | 'audio_link_mismatch'
  | 'transcription_config_changed';

export interface VerifiedTranscriptChunk {
  source: TranscriptSource;
  sequence: number;
  checkpointChecksumSha256: string;
  revision: number;
  segments: NormalizedTranscriptSegment[];
}

export interface NormalizedTranscriptSegment {
  id: string;
  source: TranscriptSource;
  sequence: number;
  speaker: 'Me' | 'Them';
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

export interface TranscriptFinalizationResult {
  reusable: VerifiedTranscriptChunk[];
  repair: Array<{
    source: TranscriptSource;
    sequence: number;
    reason: CheckpointRepairReason;
  }>;
  transcriptionRequests: Array<{
    source: TranscriptSource;
    sequence: number;
    reason: CheckpointRepairReason | 'coverage_underfilled';
  }>;
  acceptanceFrames: Array<{ sequence: number; action: 'reuse' | 'rerun' }>;
  segments: NormalizedTranscriptSegment[];
  failures: Array<{
    source: TranscriptSource;
    sequence: number;
    reason:
      | 'capture_missing'
      | 'conversion_failed'
      | 'source_failed'
      | 'coverage_repair_exhausted';
  }>;
}

const sources: TranscriptSource[] = ['mic', 'system'];
const tupleKey = (source: TranscriptSource, sequence: number) =>
  `${source}:${sequence}`;

const isFiniteInterval = (start: number, end: number) =>
  Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;

const segmentsAreStrict = (
  segments: unknown,
  duration: number,
): segments is CheckpointSegment[] => {
  if (!Array.isArray(segments)) return false;
  return segments.every((segment) => {
    if (!segment || typeof segment !== 'object') return false;
    const item = segment as CheckpointSegment;
    if (
      !isFiniteInterval(item.start, item.end) ||
      item.end > duration + 0.25 ||
      typeof item.text !== 'string' ||
      item.text.trim().length === 0
    ) {
      return false;
    }
    return (
      item.words === undefined ||
      (Array.isArray(item.words) &&
        item.words.every(
          (word) =>
            word !== null &&
            typeof word === 'object' &&
            typeof word.word === 'string' &&
            word.word.trim().length > 0 &&
            isFiniteInterval(word.start, word.end) &&
            word.start >= item.start &&
            word.end <= item.end &&
            word.end <= duration + 0.25,
        ))
    );
  });
};

// Small synchronous SHA-256 keeps stable segment identity available in the
// renderer without importing Node APIs or making this pure planner async.
const sha256 = (value: string): string => {
  const rightRotate = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const hash: number[] = [];
  const constants: number[] = [];
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
      hash[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
    }
    constants[primeCounter] = (candidate ** (1 / 3) * maxWord) | 0;
    primeCounter += 1;
  }
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) words.push(byte);
  words.push(0x80);
  while (words.length % 64 !== 56) words.push(0);
  const bitLength = bytes.length * 8;
  for (let shift = 56; shift >= 0; shift -= 8) {
    words.push(shift >= 32 ? 0 : (bitLength >>> shift) & 0xff);
  }
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
        (h + sum1 + choice + constants[index] + schedule[index]) | 0;
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
};

const normalizeSegments = (
  segments: CheckpointSegment[],
  source: TranscriptSource,
  sequence: number,
  intervalStart: number,
  intervalEnd: number,
  relative: boolean,
): NormalizedTranscriptSegment[] => {
  const normalized: NormalizedTranscriptSegment[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const rawStart = segment.start + (relative ? intervalStart : 0);
    const rawEnd = segment.end + (relative ? intervalStart : 0);
    const start = Math.max(intervalStart, rawStart);
    const end = Math.min(intervalEnd, rawEnd);
    const text = segment.text.trim();
    if (!isFiniteInterval(start, end) || !text) continue;
    const startMicros = Math.round(start * 1_000_000);
    const endMicros = Math.round(end * 1_000_000);
    const id = sha256(`${source}${sequence}${startMicros}${endMicros}${text}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const words = segment.words
      ?.map((word) => ({
        word: word.word.trim(),
        start: Math.max(start, word.start + (relative ? intervalStart : 0)),
        end: Math.min(end, word.end + (relative ? intervalStart : 0)),
      }))
      .filter((word) => word.word && isFiniteInterval(word.start, word.end));
    normalized.push({
      id,
      source,
      sequence,
      speaker: source === 'mic' ? 'Me' : 'Them',
      start,
      end,
      text,
      ...(words?.length ? { words } : {}),
    });
  }
  return normalized;
};

export const finalizeTranscriptCheckpoints = (
  input: TranscriptFinalizationInput,
): TranscriptFinalizationResult => {
  const repair: TranscriptFinalizationResult['repair'] = [];
  const requests: TranscriptFinalizationResult['transcriptionRequests'] = [];
  const failures: TranscriptFinalizationResult['failures'] = [];
  const reusable: VerifiedTranscriptChunk[] = [];
  const byTuple = new Map<string, TranscriptCheckpointCandidate[]>();
  for (const checkpoint of input.checkpoints) {
    const key = tupleKey(
      checkpoint.reference.source,
      checkpoint.reference.sequence,
    );
    byTuple.set(key, [...(byTuple.get(key) ?? []), checkpoint]);
  }
  const verifiedByTuple = new Map<string, VerifiedTranscriptChunk>();
  const candidateByTuple = new Map<string, TranscriptCheckpointCandidate>();

  for (const interval of input.intervals) {
    for (const source of sources) {
      const disposition = interval.sources[source];
      if (disposition.disposition === 'missing') {
        failures.push({
          source,
          sequence: interval.sequence,
          reason: 'capture_missing',
        });
        continue;
      }
      if (disposition.disposition === 'conversion_failed') {
        failures.push({
          source,
          sequence: interval.sequence,
          reason: 'conversion_failed',
        });
        continue;
      }
      if (
        disposition.disposition === 'verified_silence' ||
        disposition.disposition === 'source_unavailable'
      ) {
        continue;
      }
      const key = tupleKey(source, interval.sequence);
      const candidates = byTuple.get(key) ?? [];
      let reason: CheckpointRepairReason | undefined;
      const candidate = candidates[0];
      if (candidates.length === 0) reason = 'checkpoint_missing';
      else if (candidates.length !== 1) reason = 'checkpoint_corrupt';
      else if (
        candidate.reference.disposition === 'conversion_failed' ||
        candidate.reference.disposition === 'transcription_failed' ||
        candidate.reference.disposition === 'cancelled'
      ) {
        failures.push({
          source,
          sequence: interval.sequence,
          reason:
            candidate.reference.disposition === 'conversion_failed'
              ? 'conversion_failed'
              : 'source_failed',
        });
        continue;
      } else if (
        !candidate.evidence.audioChecksumVerified ||
        candidate.reference.chunkChecksumSha256 !==
          disposition.checksumSha256 ||
        candidate.sidecar.chunkChecksumSha256 !== disposition.checksumSha256 ||
        candidate.reference.chunkStartSec !== interval.start ||
        candidate.reference.chunkEndSec !== interval.end ||
        candidate.sidecar.chunkStartSec !== interval.start ||
        candidate.sidecar.chunkEndSec !== interval.end
      ) {
        reason = 'audio_link_mismatch';
      } else if (
        input.expectedConfigKey.length === 0 ||
        candidate.reference.transcriptionConfigKey.length === 0 ||
        candidate.sidecar.transcriptionConfigKey.length === 0 ||
        candidate.reference.transcriptionConfigKey !==
          input.expectedConfigKey ||
        candidate.sidecar.transcriptionConfigKey !== input.expectedConfigKey
      ) {
        reason = 'transcription_config_changed';
      } else if (
        !candidate.evidence.sidecarChecksumVerified ||
        !candidate.evidence.pathSafe ||
        candidate.reference.disposition !== 'transcribed' ||
        candidate.sidecar.schemaVersion !== 1 ||
        candidate.sidecar.meetingId !== input.meetingId ||
        candidate.sidecar.source !== source ||
        candidate.sidecar.sequence !== interval.sequence ||
        !segmentsAreStrict(
          candidate.sidecar.segments,
          interval.end - interval.start,
        )
      ) {
        reason = 'checkpoint_corrupt';
      }
      if (reason) {
        repair.push({ source, sequence: interval.sequence, reason });
        requests.push({ source, sequence: interval.sequence, reason });
        continue;
      }
      const chunk: VerifiedTranscriptChunk = {
        source,
        sequence: interval.sequence,
        checkpointChecksumSha256: candidate.reference.transcriptChecksumSha256,
        revision: candidate.reference.revision,
        segments: normalizeSegments(
          candidate.sidecar.segments,
          source,
          interval.sequence,
          interval.start,
          interval.end,
          true,
        ),
      };
      reusable.push(chunk);
      verifiedByTuple.set(key, chunk);
      candidateByTuple.set(key, candidate);
    }
  }

  for (const activity of input.speechActivity) {
    if (!activity.speechDetected) continue;
    const key = tupleKey(activity.source, activity.sequence);
    const chunk = verifiedByTuple.get(key);
    if (!chunk || chunk.segments.length > 0) continue;
    const candidate = candidateByTuple.get(key);
    if (candidate?.repairAttempted) {
      failures.push({
        source: activity.source,
        sequence: activity.sequence,
        reason: 'coverage_repair_exhausted',
      });
    } else {
      requests.push({
        source: activity.source,
        sequence: activity.sequence,
        reason: 'coverage_underfilled',
      });
    }
  }

  const acceptanceFrames: TranscriptFinalizationResult['acceptanceFrames'] = [];
  const segments: NormalizedTranscriptSegment[] = [];
  const segmentIds = new Set<string>();
  for (const interval of input.intervals) {
    const frameCandidates = input.acceptanceFrames.filter(
      (frame) => frame.sequence === interval.sequence,
    );
    const frame = frameCandidates[0];
    const mic = verifiedByTuple.get(tupleKey('mic', interval.sequence));
    const system = verifiedByTuple.get(tupleKey('system', interval.sequence));
    const frameReusable =
      frameCandidates.length === 1 &&
      frame.evidenceMatches &&
      frame.arbitrationVersion === input.arbitrationVersion &&
      frame.micCheckpointChecksumSha256 ===
        (mic?.checkpointChecksumSha256 ?? null) &&
      frame.systemCheckpointChecksumSha256 ===
        (system?.checkpointChecksumSha256 ?? null) &&
      segmentsAreStrict(frame.segments, interval.end);
    acceptanceFrames.push({
      sequence: interval.sequence,
      action: frameReusable ? 'reuse' : 'rerun',
    });
    const intervalSegments = frameReusable
      ? frame.segments.flatMap((segment) =>
          normalizeSegments(
            [segment],
            segment.source,
            interval.sequence,
            interval.start,
            interval.end,
            false,
          ),
        )
      : [...(mic?.segments ?? []), ...(system?.segments ?? [])];
    for (const segment of intervalSegments) {
      if (segmentIds.has(segment.id)) continue;
      segmentIds.add(segment.id);
      segments.push(segment);
    }
  }

  const uniqueRequests = Array.from(
    new Map(
      requests.map((request) => [
        tupleKey(request.source, request.sequence),
        request,
      ]),
    ).values(),
  );
  return {
    reusable,
    repair,
    transcriptionRequests: uniqueRequests,
    acceptanceFrames,
    segments: segments.sort((a, b) => a.start - b.start || a.end - b.end),
    failures,
  };
};
