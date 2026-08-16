import { describe, expect, it } from 'vitest';

import {
  createLiveEngineState,
  spliceParakeetFallback,
  transition,
} from '../../src/services/liveTranscription/liveEngineStateMachine';

describe('live transcription engine state machine', () => {
  it.each(['system_shadow', 'dual_shadow', 'parakeet_primary'] as const)(
    'initializes %s as running Parakeet mode',
    (mode) => {
      expect(createLiveEngineState({ mode })).toMatchObject({
        mode,
        parakeetStopped: false,
        parakeetFenced: false,
      });
    },
  );

  it('falls back from primary to MLX on AEC failure and increments the epoch', () => {
    const primaryState = createLiveEngineState({
      mode: 'parakeet_primary',
      parakeetGeneration: 4,
    });

    expect(
      transition(primaryState, { type: 'aec_failed', captureSequence: 8 }),
    ).toMatchObject({ mode: 'mlx', engineEpoch: 2, parakeetFenced: true });
  });

  it('does not restart system shadow after primary has started', () => {
    const primaryState = createLiveEngineState({ mode: 'parakeet_primary' });

    expect(
      transition(primaryState, { type: 'aec_failed', captureSequence: 8 }).mode,
    ).toBe('mlx');
  });

  it('requires Parakeet to stop before MLX when combined memory admission requires fencing', () => {
    const primaryState = createLiveEngineState({ mode: 'parakeet_primary' });
    const fallback = transition(primaryState, {
      type: 'aec_failed',
      captureSequence: 8,
      combinedMemoryAdmission: true,
    });

    expect(fallback.mlxInferenceBlockedUntilParakeetStopped).toBe(true);
    expect(() =>
      transition(fallback, { type: 'mlx_receipt', captureSequence: 9 }),
    ).toThrowError('parakeet_stop_required');
    const stopped = transition(fallback, {
      type: 'parakeet_stopped',
      engineEpoch: fallback.engineEpoch,
      parakeetGeneration: fallback.parakeetGeneration,
    });
    expect(
      transition(stopped, { type: 'mlx_receipt', captureSequence: 9 }),
    ).toMatchObject({ firstMlxReceipt: 9 });
  });

  it('preserves the first MLX receipt while accepting later ordered receipts', () => {
    const fallback = transition(
      transition(createLiveEngineState({ mode: 'parakeet_primary' }), {
        type: 'aec_failed',
        captureSequence: 8,
      }),
      {
        type: 'parakeet_stopped',
        engineEpoch: 2,
        parakeetGeneration: 1,
      },
    );
    const first = transition(fallback, {
      type: 'mlx_receipt',
      captureSequence: 9,
    });
    const later = transition(first, {
      type: 'mlx_receipt',
      captureSequence: 10,
    });

    expect(later).toMatchObject({ firstMlxReceipt: 9, lastMlxReceipt: 10 });
    expect(() =>
      transition(later, { type: 'mlx_receipt', captureSequence: 10 }),
    ).toThrowError('live_mlx_receipt_duplicate');
    expect(() =>
      transition(later, { type: 'mlx_receipt', captureSequence: 8 }),
    ).toThrowError('live_mlx_receipt_regression');
  });

  it('rejects an MLX receipt gap instead of claiming covered splice input', () => {
    const state = transition(
      transition(createLiveEngineState({ mode: 'parakeet_primary' }), {
        type: 'aec_failed',
        captureSequence: 8,
      }),
      {
        type: 'parakeet_stopped',
        engineEpoch: 2,
        parakeetGeneration: 1,
      },
    );
    const first = transition(state, {
      type: 'mlx_receipt',
      captureSequence: 8,
    });
    expect(() =>
      transition(first, { type: 'mlx_receipt', captureSequence: 10 }),
    ).toThrowError('live_mlx_receipt_gap');
  });

  it('records whether first MLX admission followed the actual Parakeet stop', () => {
    const fallback = transition(
      createLiveEngineState({ mode: 'parakeet_primary' }),
      { type: 'aec_failed', captureSequence: 8 },
    );
    expect(() =>
      transition(fallback, { type: 'mlx_receipt', captureSequence: 9 }),
    ).toThrowError('parakeet_stop_required');
  });

  it('rejects skipped Parakeet capture receipts', () => {
    const state = createLiveEngineState({ mode: 'parakeet_primary' });
    const first = transition(state, {
      type: 'parakeet_admitted',
      captureSequence: 0,
    });
    expect(() =>
      transition(first, { type: 'parakeet_admitted', captureSequence: 2 }),
    ).toThrowError('live_capture_sequence_gap');
  });

  it('rejects preview watermarks beyond the processed Parakeet receipt', () => {
    const state = createLiveEngineState({ mode: 'parakeet_primary' });
    const processed = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
      (current, captureSequence) =>
        transition(current, { type: 'parakeet_admitted', captureSequence }),
      state,
    );
    const processedState = Array.from(
      { length: 8 },
      (_, captureSequence) => captureSequence,
    ).reduce(
      (current, captureSequence) =>
        transition(current, { type: 'parakeet_processed', captureSequence }),
      processed,
    );
    expect(() =>
      transition(processedState, {
        type: 'preview_committed',
        captureSequence: 7,
        committedThroughCaptureSequence: 9,
      }),
    ).toThrowError('live_preview_receipt_not_processed');
  });

  it('rejects processing a receipt that was never admitted', () => {
    const state = createLiveEngineState({ mode: 'parakeet_primary' });
    const admitted = transition(state, {
      type: 'parakeet_admitted',
      captureSequence: 8,
    });
    expect(() =>
      transition(admitted, { type: 'parakeet_processed', captureSequence: 7 }),
    ).toThrowError('live_processed_receipt_not_admitted');
  });

  it('requires the first processed receipt to equal the admitted range start', () => {
    const state = transition(
      createLiveEngineState({ mode: 'parakeet_primary' }),
      { type: 'parakeet_admitted', captureSequence: 7 },
    );
    expect(() =>
      transition(state, { type: 'parakeet_processed', captureSequence: 8 }),
    ).toThrowError('live_processed_receipt_not_admitted');
  });

  it('splices receipts without a gap or duplicate and discards only the tentative tail', () => {
    const state = createLiveEngineState({
      mode: 'parakeet_primary',
      engineEpoch: 2,
      parakeetGeneration: 2,
    });
    const withReceipts = [
      { type: 'parakeet_admitted' as const, captureSequence: 7 },
      { type: 'parakeet_admitted' as const, captureSequence: 8 },
      { type: 'parakeet_processed' as const, captureSequence: 7 },
      { type: 'parakeet_processed' as const, captureSequence: 8 },
      {
        type: 'preview_committed' as const,
        captureSequence: 6,
        committedThroughCaptureSequence: 6,
      },
      {
        type: 'preview_tentative' as const,
        captureSequence: 7,
        tentativeThroughCaptureSequence: 7,
      },
    ].reduce(transition, state);
    const stopped = {
      ...withReceipts,
      mode: 'mlx' as const,
      parakeetFenced: true,
      parakeetStopped: true,
      fallbackCaptureSequence: 8,
      fallbackEngineEpoch: 2,
      fallbackParakeetGeneration: 2,
      firstMlxReceipt: 8,
      lastMlxReceipt: 8,
      firstMlxAfterParakeetStopped: true,
    };

    const splice = spliceParakeetFallback({
      state: stopped,
      firstMlxReceipt: 8,
      overlapRange: { start: 7, end: 8 },
      dedupDecision: 'drop_overlap',
      parakeetStoppedBeforeMlxInference: true,
    });

    expect(splice).toMatchObject({
      lastParakeetAdmittedCaptureReceipt: 8,
      lastParakeetProcessedCaptureReceipt: 8,
      lastCommittedPreviewReceipt: 6,
      committedThroughCaptureSequence: 6,
      currentTentativeReceipt: 7,
      tentativeThroughCaptureSequence: 7,
      firstMlxReceipt: 8,
      overlapRange: { start: 7, end: 8 },
      dedupDecision: 'drop_overlap',
      engineEpoch: 2,
      fallbackCaptureSequence: 8,
      noUncoveredReceipts: true,
      noDuplicateReceipts: true,
      discardedTentativeParakeetTail: true,
      retainedCommittedPreview: true,
    });
    expect(splice.state).toMatchObject({
      overlapRange: { start: 7, end: 8 },
      dedupDecision: 'drop_overlap',
    });
  });

  it('rejects a splice that leaves admitted receipts uncovered', () => {
    const state = {
      ...createLiveEngineState({ mode: 'mlx' }),
      parakeetFenced: true,
      parakeetStopped: true,
      lastParakeetAdmittedCaptureReceipt: 8,
      fallbackCaptureSequence: 8,
      fallbackEngineEpoch: 2,
      fallbackParakeetGeneration: 1,
      firstMlxReceipt: 10,
      lastMlxReceipt: 10,
      firstMlxAfterParakeetStopped: true,
    };

    expect(() =>
      spliceParakeetFallback({
        state,
        firstMlxReceipt: 10,
        parakeetStoppedBeforeMlxInference: true,
      }),
    ).toThrowError('live_receipt_gap');
  });

  it('trusts the state stop fence instead of a caller assertion', () => {
    const state = transition(
      createLiveEngineState({ mode: 'parakeet_primary' }),
      {
        type: 'aec_failed',
        captureSequence: 8,
      },
    );

    expect(() =>
      spliceParakeetFallback({
        state,
        firstMlxReceipt: 1,
        parakeetStoppedBeforeMlxInference: false,
      }),
    ).toThrowError('parakeet_stop_required');
  });

  it('requires the caller boundary to equal the state-derived first MLX receipt', () => {
    const state = {
      ...createLiveEngineState({ mode: 'mlx' }),
      parakeetFenced: true,
      parakeetStopped: true,
      fallbackCaptureSequence: 8,
      fallbackEngineEpoch: 2,
      fallbackParakeetGeneration: 1,
      firstMlxReceipt: 8,
      lastMlxReceipt: 8,
      firstMlxAfterParakeetStopped: true,
    };
    expect(() =>
      spliceParakeetFallback({
        state,
        firstMlxReceipt: 9,
        parakeetStoppedBeforeMlxInference: true,
      }),
    ).toThrowError('live_first_mlx_receipt_mismatch');
  });

  it('requires an actual MLX fallback and correlated stop before splice proof', () => {
    const primary = createLiveEngineState({ mode: 'parakeet_primary' });
    expect(() =>
      spliceParakeetFallback({
        state: primary,
        firstMlxReceipt: 1,
        parakeetStoppedBeforeMlxInference: true,
      }),
    ).toThrowError('live_fallback_not_active');

    const fallback = transition(primary, {
      type: 'aec_failed',
      captureSequence: 8,
    });
    expect(() =>
      transition(fallback, {
        type: 'parakeet_stopped',
        engineEpoch: fallback.engineEpoch - 1,
        parakeetGeneration: fallback.parakeetGeneration,
      }),
    ).toThrowError('parakeet_stop_correlation_invalid');
  });

  it('refuses splice proof while an admitted pre-fallback receipt is unprocessed', () => {
    const state = {
      ...createLiveEngineState({ mode: 'mlx' }),
      parakeetFenced: true,
      parakeetStopped: true,
      admittedCaptureStart: 7,
      admittedCaptureEnd: 8,
      lastParakeetAdmittedCaptureReceipt: 8,
      lastParakeetProcessedCaptureReceipt: 7,
      fallbackCaptureSequence: 8,
      fallbackEngineEpoch: 2,
      fallbackParakeetGeneration: 1,
      firstMlxReceipt: 8,
      lastMlxReceipt: 8,
      firstMlxAfterParakeetStopped: true,
    };
    expect(() =>
      spliceParakeetFallback({
        state,
        firstMlxReceipt: 8,
        parakeetStoppedBeforeMlxInference: true,
      }),
    ).toThrowError('live_pre_fallback_receipt_unprocessed');
  });

  it('rejects fallback when admitted receipts have no processed watermark', () => {
    const state = {
      ...createLiveEngineState({ mode: 'mlx' }),
      parakeetFenced: true,
      parakeetStopped: true,
      admittedCaptureStart: 7,
      admittedCaptureEnd: 8,
      lastParakeetAdmittedCaptureReceipt: 8,
      lastParakeetProcessedCaptureReceipt: null,
      fallbackCaptureSequence: 8,
      fallbackEngineEpoch: 2,
      fallbackParakeetGeneration: 1,
      firstMlxReceipt: 8,
      lastMlxReceipt: 8,
      firstMlxAfterParakeetStopped: true,
    };
    expect(() =>
      spliceParakeetFallback({
        state,
        firstMlxReceipt: 8,
        parakeetStoppedBeforeMlxInference: true,
      }),
    ).toThrowError('live_pre_fallback_receipt_unprocessed');
  });
});
