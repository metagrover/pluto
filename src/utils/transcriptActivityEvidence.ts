import type { SpeakerActivityWindow } from './speakerAttribution.ts';

export const STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION = 1;

export type TranscriptActivityEvidenceSource = 'capture_activity_v1';
export type TranscriptActivityEvidenceFallbackSource =
  | 'capture_activity_v1'
  | 'legacy_provisional_segments'
  | 'capture_activity_missing'
  | 'capture_activity_corrupt';

export type StoredTranscriptActivityWindow = {
  startTime: number;
  endTime: number;
  speaker: 'Me' | 'Them';
};

export type StoredTranscriptActivityEvidence = {
  schemaVersion: typeof STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION;
  source: TranscriptActivityEvidenceSource;
  windows: StoredTranscriptActivityWindow[];
};

export const CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION = 2;
export const CAPTURE_ACTIVITY_SERIALIZATION_VERSION = 1;

export type CaptureActivityProducer = {
  clock: {
    kind: 'meeting_relative_seconds';
    origin: 'recording_start';
  };
  thresholds: {
    rms: number;
    dominanceRatio: number;
    minimumSwitchIntervalMs: number;
  };
  algorithmVersion: 'speaker_activity_v1';
};

export type CaptureActivityEvidence = CaptureActivityProducer & {
  schemaVersion: typeof CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION;
  source: 'capture_activity_v2';
  serializationVersion: typeof CAPTURE_ACTIVITY_SERIALIZATION_VERSION;
  windows: StoredTranscriptActivityWindow[];
  digestSha256: string;
};

export type CaptureActivityParseResult =
  | { ok: true; evidence: CaptureActivityEvidence }
  | {
      ok: false;
      reason: 'malformed' | 'unsupported' | 'digest_mismatch';
    };

type CaptureActivityPayload = Omit<CaptureActivityEvidence, 'digestSha256'>;

export const canonicalizeCaptureActivityPayload = (
  evidence: CaptureActivityPayload,
): string =>
  JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    source: evidence.source,
    clock: evidence.clock,
    thresholds: evidence.thresholds,
    algorithmVersion: evidence.algorithmVersion,
    serializationVersion: evidence.serializationVersion,
    windows: evidence.windows,
  });

const malformed = (): CaptureActivityParseResult => ({
  ok: false,
  reason: 'malformed',
});

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const normalizeCaptureWindows = (
  value: unknown,
): StoredTranscriptActivityWindow[] | null => {
  if (!Array.isArray(value)) return null;

  const windows: StoredTranscriptActivityWindow[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return null;
    const window = candidate as Partial<StoredTranscriptActivityWindow>;
    if (
      !isFiniteNonNegative(window.startTime) ||
      !isFiniteNonNegative(window.endTime) ||
      window.endTime <= window.startTime ||
      (window.speaker !== 'Me' && window.speaker !== 'Them')
    ) {
      return null;
    }
    windows.push({
      startTime: window.startTime,
      endTime: window.endTime,
      speaker: window.speaker,
    });
  }

  windows.sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.endTime - right.endTime ||
      left.speaker.localeCompare(right.speaker),
  );

  const lastEndBySpeaker: Partial<Record<'Me' | 'Them', number>> = {};
  for (const window of windows) {
    const previousEnd = lastEndBySpeaker[window.speaker];
    if (previousEnd !== undefined && window.startTime < previousEnd)
      return null;
    lastEndBySpeaker[window.speaker] = window.endTime;
  }

  return windows;
};

const normalizeProducer = (value: unknown): CaptureActivityProducer | null => {
  if (!value || typeof value !== 'object') return null;
  const producer = value as Partial<CaptureActivityProducer>;
  const clock = producer.clock;
  const thresholds = producer.thresholds;
  if (
    !clock ||
    clock.kind !== 'meeting_relative_seconds' ||
    clock.origin !== 'recording_start' ||
    !thresholds ||
    !isFiniteNonNegative(thresholds.rms) ||
    !isFiniteNonNegative(thresholds.dominanceRatio) ||
    !isFiniteNonNegative(thresholds.minimumSwitchIntervalMs) ||
    producer.algorithmVersion !== 'speaker_activity_v1'
  ) {
    return null;
  }

  return {
    clock: {
      kind: 'meeting_relative_seconds',
      origin: 'recording_start',
    },
    thresholds: {
      rms: thresholds.rms,
      dominanceRatio: thresholds.dominanceRatio,
      minimumSwitchIntervalMs: thresholds.minimumSwitchIntervalMs,
    },
    algorithmVersion: 'speaker_activity_v1',
  };
};

const digestSha256 = async (canonical: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

export const buildCaptureActivityEvidence = async (
  windows: SpeakerActivityWindow[],
  producer: CaptureActivityProducer,
): Promise<CaptureActivityEvidence> => {
  const normalizedProducer = normalizeProducer(producer);
  const normalizedWindows = normalizeCaptureWindows(windows);
  if (!normalizedProducer || !normalizedWindows) throw new Error('malformed');

  const payload: CaptureActivityPayload = {
    schemaVersion: CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION,
    source: 'capture_activity_v2',
    ...normalizedProducer,
    serializationVersion: CAPTURE_ACTIVITY_SERIALIZATION_VERSION,
    windows: normalizedWindows,
  };

  return {
    ...payload,
    digestSha256: await digestSha256(
      canonicalizeCaptureActivityPayload(payload),
    ),
  };
};

export const parseCaptureActivityEvidence = async (
  value: unknown,
): Promise<CaptureActivityParseResult> => {
  if (!value || typeof value !== 'object') return malformed();
  const raw = value as Partial<CaptureActivityEvidence>;

  if (
    raw.schemaVersion !== CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION ||
    raw.source !== 'capture_activity_v2' ||
    raw.serializationVersion !== CAPTURE_ACTIVITY_SERIALIZATION_VERSION
  ) {
    if (
      raw.schemaVersion !== undefined &&
      raw.source !== undefined &&
      raw.serializationVersion !== undefined
    ) {
      return { ok: false, reason: 'unsupported' };
    }
    return malformed();
  }

  const producer = normalizeProducer(raw);
  const windows = normalizeCaptureWindows(raw.windows);
  if (
    !producer ||
    !windows ||
    typeof raw.digestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.digestSha256)
  ) {
    return malformed();
  }

  const payload: CaptureActivityPayload = {
    schemaVersion: CAPTURE_ACTIVITY_EVIDENCE_SCHEMA_VERSION,
    source: 'capture_activity_v2',
    ...producer,
    serializationVersion: CAPTURE_ACTIVITY_SERIALIZATION_VERSION,
    windows,
  };
  const expectedDigest = await digestSha256(
    canonicalizeCaptureActivityPayload(payload),
  );
  if (expectedDigest !== raw.digestSha256) {
    return { ok: false, reason: 'digest_mismatch' };
  }

  return {
    ok: true,
    evidence: { ...payload, digestSha256: raw.digestSha256 },
  };
};

export const verifyCaptureActivityEvidence = async (
  value: unknown,
): Promise<CaptureActivityEvidence> => {
  const result = await parseCaptureActivityEvidence(value);
  if (!result.ok) throw new Error(result.reason);
  return result.evidence;
};

const isStoredWindow = (
  value: unknown,
): value is StoredTranscriptActivityWindow =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as StoredTranscriptActivityWindow).startTime === 'number' &&
  typeof (value as StoredTranscriptActivityWindow).endTime === 'number' &&
  ((value as StoredTranscriptActivityWindow).speaker === 'Me' ||
    (value as StoredTranscriptActivityWindow).speaker === 'Them');

export const buildStoredTranscriptActivityEvidence = (
  windows: SpeakerActivityWindow[],
): StoredTranscriptActivityEvidence => ({
  schemaVersion: STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION,
  source: 'capture_activity_v1',
  windows: windows
    .filter(
      (window) =>
        (window.speaker === 'Me' || window.speaker === 'Them') &&
        Number.isFinite(window.startTime) &&
        Number.isFinite(window.endTime) &&
        window.endTime > window.startTime,
    )
    .map((window) => ({
      startTime: window.startTime,
      endTime: window.endTime,
      speaker: window.speaker,
    })),
});

export const parseStoredTranscriptActivityEvidence = (
  value: unknown,
): StoredTranscriptActivityEvidence | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as {
    schemaVersion?: unknown;
    source?: unknown;
    windows?: unknown;
  };

  if (
    raw.schemaVersion !== STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION ||
    raw.source !== 'capture_activity_v1' ||
    !Array.isArray(raw.windows)
  ) {
    return null;
  }

  const windows = raw.windows
    .filter(isStoredWindow)
    .filter(
      (window) =>
        Number.isFinite(window.startTime) &&
        Number.isFinite(window.endTime) &&
        window.endTime > window.startTime,
    );

  return {
    schemaVersion: STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION,
    source: 'capture_activity_v1',
    windows: windows.map((window) => ({
      startTime: window.startTime,
      endTime: window.endTime,
      speaker: window.speaker,
    })),
  };
};
