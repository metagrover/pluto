import type { LiveCaptureSequence, LiveEngineMode } from './contracts';

type Receipt = LiveCaptureSequence | null;

export type LiveEngineState = {
  mode: LiveEngineMode;
  engineEpoch: number;
  parakeetGeneration: number;
  parakeetFenced: boolean;
  parakeetStopped: boolean;
  mlxInferenceBlockedUntilParakeetStopped: boolean;
  lastParakeetAdmittedCaptureReceipt: Receipt;
  admittedCaptureStart: Receipt;
  admittedCaptureEnd: Receipt;
  lastParakeetProcessedCaptureReceipt: Receipt;
  lastCommittedPreviewReceipt: Receipt;
  committedThroughCaptureSequence: Receipt;
  currentTentativeReceipt: Receipt;
  tentativeThroughCaptureSequence: Receipt;
  firstMlxReceipt: Receipt;
  lastMlxReceipt: Receipt;
  firstMlxAfterParakeetStopped: boolean;
  fallbackEngineEpoch: number | null;
  fallbackParakeetGeneration: number | null;
  overlapRange: { start: number; end: number } | null;
  dedupDecision: 'none' | 'drop_overlap';
  fallbackCaptureSequence: Receipt;
};

export type LiveEngineEvent =
  | {
      type: 'aec_failed';
      captureSequence: number;
      combinedMemoryAdmission?: boolean;
    }
  | {
      type: 'parakeet_failed';
      captureSequence: number;
      combinedMemoryAdmission?: boolean;
    }
  | {
      type: 'parakeet_stopped';
      engineEpoch?: number;
      parakeetGeneration?: number;
    }
  | { type: 'parakeet_admitted'; captureSequence: number }
  | { type: 'parakeet_processed'; captureSequence: number }
  | {
      type: 'preview_committed';
      captureSequence: number;
      committedThroughCaptureSequence: number;
    }
  | {
      type: 'preview_tentative';
      captureSequence: number;
      tentativeThroughCaptureSequence: number;
    }
  | { type: 'mlx_receipt'; captureSequence: number };

export type LiveFallbackSplice = Pick<
  LiveEngineState,
  | 'lastParakeetAdmittedCaptureReceipt'
  | 'lastParakeetProcessedCaptureReceipt'
  | 'lastCommittedPreviewReceipt'
  | 'committedThroughCaptureSequence'
  | 'currentTentativeReceipt'
  | 'tentativeThroughCaptureSequence'
  | 'firstMlxReceipt'
  | 'fallbackCaptureSequence'
  | 'overlapRange'
  | 'dedupDecision'
  | 'engineEpoch'
> & {
  state: LiveEngineState;
  noUncoveredReceipts: true;
  noDuplicateReceipts: true;
  discardedTentativeParakeetTail: true;
  retainedCommittedPreview: true;
  parakeetStoppedBeforeMlxInference: true;
};

const assertSequence = (sequence: number): void => {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('live_capture_sequence_invalid');
  }
};

const assertMonotonic = (prior: Receipt, next: number): void => {
  assertSequence(next);
  if (prior !== null && next < prior) {
    throw new Error('live_capture_sequence_regression');
  }
};

const assertContiguous = (prior: Receipt, next: number): void => {
  assertSequence(next);
  if (prior !== null && next !== prior + 1) {
    throw new Error('live_capture_sequence_gap');
  }
};

export const createLiveEngineState = (
  input: {
    mode?: LiveEngineMode;
    engineEpoch?: number;
    parakeetGeneration?: number;
  } = {},
): LiveEngineState => {
  const engineEpoch = input.engineEpoch ?? 1;
  const parakeetGeneration = input.parakeetGeneration ?? 1;
  if (!Number.isSafeInteger(engineEpoch) || engineEpoch < 1) {
    throw new Error('live_engine_epoch_invalid');
  }
  if (!Number.isSafeInteger(parakeetGeneration) || parakeetGeneration < 1) {
    throw new Error('parakeet_generation_invalid');
  }
  return {
    mode: input.mode ?? 'mlx',
    engineEpoch,
    parakeetGeneration,
    parakeetFenced: false,
    parakeetStopped: input.mode === undefined || input.mode === 'mlx',
    mlxInferenceBlockedUntilParakeetStopped: false,
    lastParakeetAdmittedCaptureReceipt: null,
    admittedCaptureStart: null,
    admittedCaptureEnd: null,
    lastParakeetProcessedCaptureReceipt: null,
    lastCommittedPreviewReceipt: null,
    committedThroughCaptureSequence: null,
    currentTentativeReceipt: null,
    tentativeThroughCaptureSequence: null,
    firstMlxReceipt: null,
    lastMlxReceipt: null,
    firstMlxAfterParakeetStopped: false,
    fallbackEngineEpoch: null,
    fallbackParakeetGeneration: null,
    overlapRange: null,
    dedupDecision: 'none',
    fallbackCaptureSequence: null,
  };
};

export const transition = (
  state: LiveEngineState,
  event: LiveEngineEvent,
): LiveEngineState => {
  switch (event.type) {
    case 'aec_failed':
    case 'parakeet_failed': {
      assertSequence(event.captureSequence);
      if (state.mode === 'mlx') return state;
      return {
        ...state,
        mode: 'mlx',
        engineEpoch: state.engineEpoch + 1,
        parakeetFenced: true,
        parakeetStopped: false,
        mlxInferenceBlockedUntilParakeetStopped:
          event.combinedMemoryAdmission === true,
        fallbackCaptureSequence: event.captureSequence,
        fallbackEngineEpoch: state.engineEpoch + 1,
        fallbackParakeetGeneration: state.parakeetGeneration,
      };
    }
    case 'parakeet_stopped':
      if (
        state.fallbackCaptureSequence !== null &&
        (event.engineEpoch !== state.fallbackEngineEpoch ||
          event.parakeetGeneration !== state.fallbackParakeetGeneration)
      ) {
        throw new Error('parakeet_stop_correlation_invalid');
      }
      return {
        ...state,
        parakeetStopped: true,
        mlxInferenceBlockedUntilParakeetStopped: false,
      };
    case 'parakeet_admitted':
      if (state.parakeetFenced || state.mode === 'mlx') {
        throw new Error('live_engine_fenced');
      }
      assertContiguous(
        state.lastParakeetAdmittedCaptureReceipt,
        event.captureSequence,
      );
      return {
        ...state,
        lastParakeetAdmittedCaptureReceipt: event.captureSequence,
        admittedCaptureStart:
          state.admittedCaptureStart ?? event.captureSequence,
        admittedCaptureEnd: event.captureSequence,
      };
    case 'parakeet_processed':
      if (state.parakeetFenced || state.mode === 'mlx') {
        throw new Error('live_engine_fenced');
      }
      assertContiguous(
        state.lastParakeetProcessedCaptureReceipt,
        event.captureSequence,
      );
      if (
        state.lastParakeetAdmittedCaptureReceipt === null ||
        event.captureSequence > state.lastParakeetAdmittedCaptureReceipt ||
        state.admittedCaptureStart === null ||
        state.admittedCaptureEnd === null ||
        event.captureSequence < state.admittedCaptureStart ||
        event.captureSequence > state.admittedCaptureEnd ||
        (state.lastParakeetProcessedCaptureReceipt === null &&
          event.captureSequence !== state.admittedCaptureStart)
      ) {
        throw new Error('live_processed_receipt_not_admitted');
      }
      return {
        ...state,
        lastParakeetProcessedCaptureReceipt: event.captureSequence,
      };
    case 'preview_committed':
      if (state.parakeetFenced) throw new Error('live_engine_fenced');
      if (
        state.lastParakeetProcessedCaptureReceipt === null ||
        event.committedThroughCaptureSequence >
          state.lastParakeetProcessedCaptureReceipt
      ) {
        throw new Error('live_preview_receipt_not_processed');
      }
      assertMonotonic(state.lastCommittedPreviewReceipt, event.captureSequence);
      assertMonotonic(
        state.committedThroughCaptureSequence,
        event.committedThroughCaptureSequence,
      );
      if (event.committedThroughCaptureSequence > event.captureSequence) {
        throw new Error('live_committed_receipt_invalid');
      }
      return {
        ...state,
        lastCommittedPreviewReceipt: event.captureSequence,
        committedThroughCaptureSequence: event.committedThroughCaptureSequence,
      };
    case 'preview_tentative':
      if (state.parakeetFenced) throw new Error('live_engine_fenced');
      if (
        state.lastParakeetProcessedCaptureReceipt === null ||
        event.tentativeThroughCaptureSequence >
          state.lastParakeetProcessedCaptureReceipt
      ) {
        throw new Error('live_preview_receipt_not_processed');
      }
      assertMonotonic(state.currentTentativeReceipt, event.captureSequence);
      assertMonotonic(
        state.tentativeThroughCaptureSequence,
        event.tentativeThroughCaptureSequence,
      );
      if (event.tentativeThroughCaptureSequence > event.captureSequence) {
        throw new Error('live_tentative_receipt_invalid');
      }
      return {
        ...state,
        currentTentativeReceipt: event.captureSequence,
        tentativeThroughCaptureSequence: event.tentativeThroughCaptureSequence,
      };
    case 'mlx_receipt': {
      assertSequence(event.captureSequence);
      if (state.mode !== 'mlx') throw new Error('live_mlx_not_active');
      if (state.mlxInferenceBlockedUntilParakeetStopped) {
        throw new Error('parakeet_stop_required');
      }
      if (!state.parakeetStopped) {
        throw new Error('parakeet_stop_required');
      }
      const lastMlxReceipt = state.lastMlxReceipt ?? state.firstMlxReceipt;
      if (lastMlxReceipt !== null && event.captureSequence === lastMlxReceipt) {
        throw new Error('live_mlx_receipt_duplicate');
      }
      if (lastMlxReceipt !== null && event.captureSequence < lastMlxReceipt) {
        throw new Error('live_mlx_receipt_regression');
      }
      if (
        lastMlxReceipt !== null &&
        event.captureSequence !== lastMlxReceipt + 1
      ) {
        throw new Error('live_mlx_receipt_gap');
      }
      return {
        ...state,
        firstMlxReceipt: state.firstMlxReceipt ?? event.captureSequence,
        lastMlxReceipt: event.captureSequence,
        firstMlxAfterParakeetStopped:
          state.firstMlxReceipt === null && state.parakeetStopped,
      };
    }
  }
};

export const spliceParakeetFallback = (input: {
  state: LiveEngineState;
  firstMlxReceipt: number;
  overlapRange?: { start: number; end: number } | null;
  dedupDecision?: 'none' | 'drop_overlap';
  parakeetStoppedBeforeMlxInference: boolean;
}): LiveFallbackSplice => {
  const { state } = input;
  assertSequence(input.firstMlxReceipt);
  if (state.mode !== 'mlx' || !state.parakeetFenced) {
    throw new Error('live_fallback_not_active');
  }
  if (state.fallbackCaptureSequence === null) {
    throw new Error('live_fallback_not_recorded');
  }
  if (!state.parakeetStopped) {
    throw new Error('parakeet_stop_required');
  }
  if (!state.firstMlxAfterParakeetStopped) {
    throw new Error('live_mlx_started_before_parakeet_stop');
  }
  if (
    state.admittedCaptureEnd !== null &&
    state.lastParakeetProcessedCaptureReceipt !== state.admittedCaptureEnd
  ) {
    throw new Error('live_pre_fallback_receipt_unprocessed');
  }
  if (state.firstMlxReceipt === null) {
    throw new Error('live_first_mlx_receipt_missing');
  }
  if (state.firstMlxReceipt !== input.firstMlxReceipt) {
    throw new Error('live_first_mlx_receipt_mismatch');
  }
  const processed = state.lastParakeetProcessedCaptureReceipt;
  const overlapRange = input.overlapRange ?? null;
  const dedupDecision = input.dedupDecision ?? 'none';
  if (overlapRange) {
    assertSequence(overlapRange.start);
    assertSequence(overlapRange.end);
    if (overlapRange.end < overlapRange.start) {
      throw new Error('live_overlap_range_invalid');
    }
    if (processed === null || overlapRange.end > processed) {
      throw new Error('live_overlap_range_unprocessed');
    }
    if (dedupDecision !== 'drop_overlap') {
      throw new Error('live_overlap_dedup_required');
    }
  } else if (dedupDecision !== 'none') {
    throw new Error('live_overlap_dedup_invalid');
  }
  if (processed !== null && input.firstMlxReceipt > processed + 1) {
    throw new Error('live_receipt_gap');
  }
  if (
    processed === null &&
    state.lastParakeetAdmittedCaptureReceipt !== null &&
    input.firstMlxReceipt > state.lastParakeetAdmittedCaptureReceipt + 1
  ) {
    throw new Error('live_receipt_gap');
  }
  if (
    state.fallbackCaptureSequence !== null &&
    input.firstMlxReceipt > state.fallbackCaptureSequence + 1
  ) {
    throw new Error('live_receipt_gap');
  }
  if (
    processed !== null &&
    input.firstMlxReceipt <= processed &&
    (!overlapRange ||
      overlapRange.start > input.firstMlxReceipt ||
      overlapRange.end < processed)
  ) {
    throw new Error('live_receipt_duplicate');
  }
  const spliceState: LiveEngineState = {
    ...state,
    firstMlxReceipt: state.firstMlxReceipt ?? input.firstMlxReceipt,
    lastMlxReceipt: state.lastMlxReceipt ?? input.firstMlxReceipt,
    overlapRange,
    dedupDecision,
  };
  return {
    lastParakeetAdmittedCaptureReceipt:
      state.lastParakeetAdmittedCaptureReceipt,
    lastParakeetProcessedCaptureReceipt:
      state.lastParakeetProcessedCaptureReceipt,
    lastCommittedPreviewReceipt: state.lastCommittedPreviewReceipt,
    committedThroughCaptureSequence: state.committedThroughCaptureSequence,
    currentTentativeReceipt: state.currentTentativeReceipt,
    tentativeThroughCaptureSequence: state.tentativeThroughCaptureSequence,
    firstMlxReceipt: spliceState.firstMlxReceipt,
    fallbackCaptureSequence: state.fallbackCaptureSequence,
    overlapRange,
    dedupDecision,
    engineEpoch: state.engineEpoch,
    state: spliceState,
    noUncoveredReceipts: true,
    noDuplicateReceipts: true,
    discardedTentativeParakeetTail: true,
    retainedCommittedPreview: true,
    parakeetStoppedBeforeMlxInference: true,
  };
};

export const buildFallbackSplice = spliceParakeetFallback;

export const createInitialLiveEngineState = createLiveEngineState;

export const reduceLiveEngineState = transition;
