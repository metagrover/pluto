export type TranscriptValidationRetryStage =
  | 'transcribing'
  | 'reviewing_evidence'
  | 'saving';

export type TranscriptValidationRetryLease = {
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: TranscriptValidationRetryStage;
};

export type TranscriptValidationRetryFailure =
  | 'retry_timeout'
  | 'retry_failed'
  | 'retry_interrupted';

export type TranscriptIntegrityRecord = Record<string, unknown> & {
  retry?: TranscriptValidationRetryLease;
  retryFailure?: TranscriptValidationRetryFailure;
};

const MINIMUM_RETRY_MS = 10 * 60_000;

export const buildRetryDeadline = (
  nowMs: number,
  recordingDurationSeconds: number,
) =>
  nowMs +
  Math.max(MINIMUM_RETRY_MS, Math.max(0, recordingDurationSeconds) * 2 * 1000);

export const readRetryLease = (
  integrity: unknown,
): TranscriptValidationRetryLease | null => {
  if (!integrity || typeof integrity !== 'object') return null;
  const retry = (integrity as TranscriptIntegrityRecord).retry;
  if (
    !retry ||
    typeof retry.runId !== 'string' ||
    typeof retry.startedAt !== 'string' ||
    typeof retry.deadlineAt !== 'string' ||
    !['transcribing', 'reviewing_evidence', 'saving'].includes(retry.stage)
  ) {
    return null;
  }
  return retry;
};

export const beginRetryLease = (
  integrity: TranscriptIntegrityRecord,
  retry: TranscriptValidationRetryLease,
): TranscriptIntegrityRecord =>
  integrity.schemaVersion === 2
    ? {
        ...integrity,
        state: 'validating',
        causes: [],
        retry,
        validationProof: undefined,
        retryFailure: undefined,
      }
    : {
        ...integrity,
        retry,
        retryFailure: undefined,
      };

export const finishRetryLease = (
  integrity: TranscriptIntegrityRecord,
  retryFailure?: TranscriptValidationRetryFailure,
): TranscriptIntegrityRecord => {
  const { retry: _retry, retryFailure: _priorFailure, ...prior } = integrity;
  if (integrity.schemaVersion === 2) {
    const failureCode =
      retryFailure === 'retry_timeout'
        ? 'validation_retry_timeout'
        : retryFailure === 'retry_failed'
          ? 'validation_retry_failed'
          : retryFailure === 'retry_interrupted'
            ? 'validation_retry_interrupted'
            : null;
    return failureCode
      ? {
          ...prior,
          state: 'needs_attention',
          causes: [{ code: failureCode }],
          validationProof: undefined,
        }
      : prior;
  }
  return retryFailure ? { ...prior, retryFailure } : prior;
};

export const parseIntegrityRecord = (
  value: string | null | undefined,
): TranscriptIntegrityRecord => {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as TranscriptIntegrityRecord)
      : {};
  } catch {
    return {};
  }
};

const TRANSCRIPT_OWNED_FIELDS = [
  'transcript_status',
  'transcript_validated_at',
  'transcript_integrity_json',
  'transcript_json',
  'enhanced_notes',
  'analysis_json',
  'value_signals_json',
  'downstream_processing_json',
] as const;

export const mergeTranscriptOwnedFields = <T extends Record<string, unknown>>(
  current: T,
  update: Record<string, unknown>,
): T => {
  const merged: Record<string, unknown> = { ...current };
  for (const field of TRANSCRIPT_OWNED_FIELDS) {
    if (field in update) merged[field] = update[field];
  }
  return merged as T;
};
