export const STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION = 1;

export type StopToValidatedLatencyUnavailableReason =
  | 'not_started'
  | 'invalid_timestamp'
  | 'timestamp_regression'
  | 'not_validated'
  | 'recovery_required'
  | 'validated_save_failed';

export type StopToValidatedLatencySummary =
  | {
      schemaVersion: typeof STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION;
      status: 'available';
      durationMs: number;
    }
  | {
      schemaVersion: typeof STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION;
      status: 'unavailable';
      reason: StopToValidatedLatencyUnavailableReason;
    };

export type StopToValidatedLatencyOperation =
  | {
      outcome: 'recorded' | 'already_terminal' | 'invalid';
      summary: StopToValidatedLatencySummary;
    }
  | { outcome: 'recorded'; summary: null };

const unavailableReasons = new Set<StopToValidatedLatencyUnavailableReason>([
  'not_started',
  'invalid_timestamp',
  'timestamp_regression',
  'not_validated',
  'recovery_required',
  'validated_save_failed',
]);

const cloneSummary = (
  summary: StopToValidatedLatencySummary,
): StopToValidatedLatencySummary => ({ ...summary });

export function parseStopToValidatedLatencySummary(
  value: unknown,
): StopToValidatedLatencySummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION ||
    (record.status !== 'available' && record.status !== 'unavailable')
  ) {
    return null;
  }

  if (record.status === 'available') {
    if (
      Object.keys(record).length !== 3 ||
      !Number.isSafeInteger(record.durationMs) ||
      Number(record.durationMs) < 0
    ) {
      return null;
    }
    return {
      schemaVersion: STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION,
      status: 'available',
      durationMs: Number(record.durationMs),
    };
  }

  if (
    Object.keys(record).length !== 3 ||
    typeof record.reason !== 'string' ||
    !unavailableReasons.has(
      record.reason as StopToValidatedLatencyUnavailableReason,
    )
  ) {
    return null;
  }
  return {
    schemaVersion: STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION,
    status: 'unavailable',
    reason: record.reason as StopToValidatedLatencyUnavailableReason,
  };
}

export function createStopToValidatedLatencyAccumulator() {
  let stopAtMs: number | null = null;
  let terminal: StopToValidatedLatencySummary | null = null;

  const freezeInvalid = (
    reason: StopToValidatedLatencyUnavailableReason,
  ): StopToValidatedLatencyOperation => {
    terminal = {
      schemaVersion: STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION,
      status: 'unavailable',
      reason,
    };
    return { outcome: 'invalid', summary: cloneSummary(terminal) };
  };

  return {
    acceptStop(atMs: number): StopToValidatedLatencyOperation {
      if (terminal) {
        return {
          outcome: 'already_terminal',
          summary: cloneSummary(terminal),
        };
      }
      if (!Number.isFinite(atMs)) return freezeInvalid('invalid_timestamp');
      if (stopAtMs !== null) return freezeInvalid('invalid_timestamp');
      stopAtMs = atMs;
      return { outcome: 'recorded', summary: null };
    },

    markUnavailable(
      reason: Exclude<
        StopToValidatedLatencyUnavailableReason,
        'not_started' | 'invalid_timestamp' | 'timestamp_regression'
      >,
    ): StopToValidatedLatencyOperation {
      if (terminal) {
        return {
          outcome: 'already_terminal',
          summary: cloneSummary(terminal),
        };
      }
      terminal = {
        schemaVersion: STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION,
        status: 'unavailable',
        reason,
      };
      return { outcome: 'recorded', summary: cloneSummary(terminal) };
    },

    completeValidatedSave(atMs: number): StopToValidatedLatencyOperation {
      if (terminal) {
        return {
          outcome: 'already_terminal',
          summary: cloneSummary(terminal),
        };
      }
      if (!Number.isFinite(atMs)) return freezeInvalid('invalid_timestamp');
      if (stopAtMs === null) return freezeInvalid('not_started');
      if (atMs < stopAtMs) return freezeInvalid('timestamp_regression');
      terminal = {
        schemaVersion: STOP_TO_VALIDATED_LATENCY_SCHEMA_VERSION,
        status: 'available',
        durationMs: Math.round(atMs - stopAtMs),
      };
      return { outcome: 'recorded', summary: cloneSummary(terminal) };
    },

    snapshot(): StopToValidatedLatencySummary | null {
      return terminal ? cloneSummary(terminal) : null;
    },
  };
}
