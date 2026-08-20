export type MeetingFailurePresentation = {
  title: string;
  detail: string;
  actionLabel: 'Retry transcription' | 'Retry analysis' | null;
};

type MeetingFailurePresentationInput = {
  retryableFinalTranscription: boolean;
  captureRecoveryRequired: boolean;
  captureGap: boolean;
  hasExistingAnalysis: boolean;
  downstreamFailed: boolean;
};

export const resolveMeetingFailurePresentation = (
  input: MeetingFailurePresentationInput,
): MeetingFailurePresentation | null => {
  if (input.retryableFinalTranscription) {
    return {
      title: 'Transcript needs another pass',
      detail: 'Your recording is safe.',
      actionLabel: 'Retry transcription',
    };
  }
  if (input.captureRecoveryRequired) {
    return {
      title: 'Recording saved',
      detail: "Pluto couldn't finish the transcript. Your recording is safe.",
      actionLabel: null,
    };
  }
  if (input.captureGap) {
    return {
      title: 'Partial transcript',
      detail: input.hasExistingAnalysis
        ? 'Analysis uses the available transcript. Some captured audio is missing.'
        : 'Some captured audio is missing from this transcript.',
      actionLabel: null,
    };
  }
  if (input.downstreamFailed) {
    return {
      title: 'Analysis needs another pass',
      detail: 'Your transcript is ready.',
      actionLabel: 'Retry analysis',
    };
  }
  return null;
};
