export type FinalTranscriptionStage =
  | 'preparing'
  | 'transcribing_mic'
  | 'transcribing_system'
  | 'reviewing_integrity'
  | 'saving';

export type FinalTranscriptionFailure =
  | 'evidence_unsealed'
  | 'runtime_unavailable'
  | 'resource_policy_denied'
  | 'required_source_failed'
  | 'integrity_rejected'
  | 'conditional_save_conflict'
  | 'cancelled';

export type FinalTranscriptionLease = {
  schemaVersion: 1;
  state: 'processing';
  policy: 'parakeet_final_v1';
  runId: string;
  captureGeneration: string;
  startedAt: string;
  deadlineAt: string;
  stage: FinalTranscriptionStage;
};

const MINIMUM_FINAL_TRANSCRIPTION_MS = 15 * 60_000;

export const buildFinalTranscriptionLease = (input: {
  runId: string;
  captureGeneration: string;
  recordingDurationSeconds: number;
  now?: number;
}): FinalTranscriptionLease => {
  const now = input.now ?? Date.now();
  const durationMs = Math.max(0, input.recordingDurationSeconds) * 4_000;
  return {
    schemaVersion: 1,
    state: 'processing',
    policy: 'parakeet_final_v1',
    runId: input.runId,
    captureGeneration: input.captureGeneration,
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(
      now + Math.max(MINIMUM_FINAL_TRANSCRIPTION_MS, durationMs),
    ).toISOString(),
    stage: 'preparing',
  };
};

export const advanceFinalTranscriptionLease = (
  lease: FinalTranscriptionLease,
  stage: FinalTranscriptionStage,
): FinalTranscriptionLease => ({ ...lease, stage });

export const readFinalTranscriptionLease = (
  value: unknown,
): FinalTranscriptionLease | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const lease = value as Partial<FinalTranscriptionLease>;
  if (
    lease.schemaVersion !== 1 ||
    lease.state !== 'processing' ||
    lease.policy !== 'parakeet_final_v1' ||
    typeof lease.runId !== 'string' ||
    typeof lease.captureGeneration !== 'string' ||
    typeof lease.startedAt !== 'string' ||
    typeof lease.deadlineAt !== 'string' ||
    ![
      'preparing',
      'transcribing_mic',
      'transcribing_system',
      'reviewing_integrity',
      'saving',
    ].includes(String(lease.stage))
  ) {
    return null;
  }
  return lease as FinalTranscriptionLease;
};

export const finishFinalTranscriptionLease = (
  lease: FinalTranscriptionLease,
  failure?: FinalTranscriptionFailure,
) =>
  failure
    ? ({
        schemaVersion: 1,
        state: 'needs_attention',
        policy: lease.policy,
        captureGeneration: lease.captureGeneration,
        failure,
      } as const)
    : ({
        schemaVersion: 1,
        state: 'complete',
        policy: lease.policy,
        captureGeneration: lease.captureGeneration,
      } as const);
