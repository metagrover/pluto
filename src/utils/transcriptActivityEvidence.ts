import type { SpeakerActivityWindow } from './speakerAttribution';

export const STORED_TRANSCRIPT_ACTIVITY_EVIDENCE_SCHEMA_VERSION = 1;

export type TranscriptActivityEvidenceSource = 'capture_activity_v1';
export type TranscriptActivityEvidenceFallbackSource =
  | 'capture_activity_v1'
  | 'legacy_provisional_segments';

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

  const windows = raw.windows.filter(isStoredWindow).filter(
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
