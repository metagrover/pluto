import { describe, expect, it } from 'vitest';

import {
  buildFinalTranscriptionLease,
  finishFinalTranscriptionLease,
} from '../../src/services/finalTranscription/finalTranscriptionLease';

describe('final transcription lease', () => {
  it('binds one run to sealed capture evidence and a finite deadline', () => {
    const lease = buildFinalTranscriptionLease({
      runId: 'run-1',
      captureGeneration: 'generation-7',
      recordingDurationSeconds: 120,
      now: 1_000,
    });

    expect(lease).toMatchObject({
      schemaVersion: 1,
      state: 'processing',
      policy: 'parakeet_final_v1',
      captureGeneration: 'generation-7',
      stage: 'preparing',
    });
    expect(Date.parse(lease.deadlineAt)).toBeGreaterThan(
      Date.parse(lease.startedAt),
    );
  });

  it('finishes with only a stable content-free failure code', () => {
    const lease = buildFinalTranscriptionLease({
      runId: 'run-1',
      captureGeneration: 'generation-7',
      recordingDurationSeconds: 120,
      now: 1_000,
    });

    expect(finishFinalTranscriptionLease(lease, 'integrity_rejected')).toEqual({
      schemaVersion: 1,
      state: 'needs_attention',
      policy: 'parakeet_final_v1',
      captureGeneration: 'generation-7',
      failure: 'integrity_rejected',
    });
  });
});
