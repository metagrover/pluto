import type {
  StopToValidatedLatencySummary,
  createStopToValidatedLatencyAccumulator,
} from '../utils/stopToValidatedLatency';
import { buildTranscriptJsonPayload } from '../utils/transcriptSchema';

type StopToValidatedLatencyAccumulator = ReturnType<
  typeof createStopToValidatedLatencyAccumulator
>;

export const startStopToValidatedLatencyAfterAcceptedStop = (params: {
  acceptedStop: unknown | null;
  accumulator: StopToValidatedLatencyAccumulator;
  nowMs: number;
}): boolean => {
  if (!params.acceptedStop) return false;
  params.accumulator.acceptStop(params.nowMs);
  return true;
};

export type StopToValidatedUnavailableOutcome =
  | 'needs_attention'
  | 'recovery_required'
  | 'validated_save_failed';

export const markStopToValidatedLatencyUnavailable = (
  accumulator: StopToValidatedLatencyAccumulator,
  outcome: StopToValidatedUnavailableOutcome,
): StopToValidatedLatencySummary => {
  const reason =
    outcome === 'needs_attention'
      ? 'not_validated'
      : outcome === 'recovery_required'
        ? 'recovery_required'
        : 'validated_save_failed';
  return accumulator.markUnavailable(reason)
    .summary as StopToValidatedLatencySummary;
};

export const buildInitialValidatedMeetingPayload = <
  Meeting extends Record<string, unknown>,
>(params: {
  meeting: Meeting;
  segments: unknown[];
  transcriptMetadata: Parameters<typeof buildTranscriptJsonPayload>[1];
  participants: string[];
}) => ({
  ...params.meeting,
  transcript_json: JSON.stringify(
    buildTranscriptJsonPayload(params.segments, params.transcriptMetadata),
  ),
  user_notes:
    typeof params.meeting.user_notes === 'string'
      ? params.meeting.user_notes
      : '',
  enhanced_notes: null,
  analysis_json: null,
  value_signals_json: null,
  participants: [...params.participants],
  finalization_status: 'finalized' as const,
  finalization_error_category: null,
});

export type LatencyPatchOutcome =
  | 'updated'
  | 'already_current'
  | 'conflict'
  | 'missing'
  | 'failed';

export const persistLatencyAndDerivedIntelligence = async <Downstream>(params: {
  patchLatency: () => Promise<LatencyPatchOutcome>;
  runDownstream: () => Promise<Downstream>;
}): Promise<{
  patchOutcome: LatencyPatchOutcome;
  downstream: Downstream;
}> => {
  const [patchOutcome, downstream] = await Promise.all([
    params.patchLatency().catch(() => 'failed' as const),
    params.runDownstream(),
  ]);
  return { patchOutcome, downstream };
};

export const persistTranscriptThenRunLatencyPatchAndDownstream = async <
  Downstream,
>(params: {
  persistTranscript: () => Promise<unknown>;
  patchLatency: () => Promise<LatencyPatchOutcome>;
  runDownstream: () => Promise<Downstream>;
}): Promise<{
  patchOutcome: LatencyPatchOutcome;
  downstream: Downstream;
}> => {
  await params.persistTranscript();
  return await persistLatencyAndDerivedIntelligence(params);
};

export const persistDerivedAfterLatencyPatch = async <Result>(params: {
  patchOutcome: LatencyPatchOutcome;
  persistDerived: () => Promise<Result>;
}): Promise<
  | { outcome: 'persisted'; result: Result }
  | { outcome: 'suppressed' }
  | { outcome: 'failed' }
> => {
  if (
    params.patchOutcome !== 'updated' &&
    params.patchOutcome !== 'already_current'
  ) {
    return { outcome: 'suppressed' };
  }
  try {
    return { outcome: 'persisted', result: await params.persistDerived() };
  } catch {
    return { outcome: 'failed' };
  }
};
