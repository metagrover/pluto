export type MeetingFailurePresentation = {
  title: string;
  detail: string;
  actionLabel: 'Retry transcription' | 'Retry analysis' | null;
};

export type MeetingRegenerationFailurePresentation = {
  title: string;
  detail: string;
  canRetry: boolean;
};

type MeetingRegenerationFailureInput = {
  kind:
    | 'transcript_not_ready'
    | 'missing_transcript'
    | 'invalid_response'
    | 'generation_failed'
    | 'request_failed';
  issues?: string[];
  error?: unknown;
  hasExistingNotes: boolean;
};

const withPreservationCopy = (
  detail: string,
  hasExistingNotes: boolean,
): string =>
  hasExistingNotes ? `${detail} Your current notes are unchanged.` : detail;

export const resolveMeetingRegenerationFailurePresentation = (
  input: MeetingRegenerationFailureInput,
): MeetingRegenerationFailurePresentation => {
  if (input.kind === 'transcript_not_ready') {
    return {
      title: "Notes can't be regenerated yet",
      detail: 'The transcript is still being prepared.',
      canRetry: false,
    };
  }
  if (input.kind === 'missing_transcript') {
    return {
      title: "Notes can't be regenerated",
      detail: 'No transcript is available for this meeting.',
      canRetry: false,
    };
  }

  const title = input.hasExistingNotes
    ? "Notes weren't regenerated"
    : "Notes weren't generated";
  if (input.kind === 'invalid_response') {
    return {
      title,
      detail: withPreservationCopy(
        "The model returned a response Pluto couldn't use.",
        input.hasExistingNotes,
      ),
      canRetry: true,
    };
  }

  const evidence = [...(input.issues ?? []), String(input.error ?? '')].join(
    ' ',
  );
  if (
    /api key|not configured|unauthorized|forbidden|authentication|credentials/i.test(
      evidence,
    )
  ) {
    return {
      title: "Pluto couldn't reach the configured model",
      detail: withPreservationCopy(
        'Check your model settings, then try again.',
        input.hasExistingNotes,
      ),
      canRetry: true,
    };
  }

  if (
    input.kind === 'generation_failed' ||
    /abort|timed out|timeout|per-topic analysis passes failed|busy/i.test(
      evidence,
    )
  ) {
    return {
      title,
      detail: withPreservationCopy(
        "The local model didn't finish this pass.",
        input.hasExistingNotes,
      ),
      canRetry: true,
    };
  }

  return {
    title,
    detail: withPreservationCopy(
      "Pluto couldn't finish this pass. Try again in a moment.",
      input.hasExistingNotes,
    ),
    canRetry: true,
  };
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
