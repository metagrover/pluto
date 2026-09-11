import { describe, expect, it } from 'vitest';
import {
  resolveMeetingFailurePresentation,
  resolveMeetingRegenerationFailurePresentation,
  resolveMeetingRetryProgressPresentation,
} from '../../src/components/features/meetingFailurePresentation';

describe('meeting failure presentation', () => {
  it('does not offer transcription retry as a remedy for incomplete participant audio', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        systemCaptureIncomplete: true,
        hasExistingTranscript: true,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: true,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Participant audio could not be verified',
      detail:
        'The System recording is incomplete or could not be verified. Your existing transcript has been kept. Retrying transcription cannot restore missing audio.',
      actionLabel: null,
    });
  });

  it('offers notes generation when participant audio is incomplete and existing transcript is ready without analysis', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        systemCaptureIncomplete: true,
        hasExistingTranscript: true,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Participant audio could not be verified',
      detail:
        'The System recording is incomplete or could not be verified. Your existing transcript has been kept. Retrying transcription cannot restore missing audio.',
      actionLabel: 'Generate notes',
    });
  });

  it('offers the only recovery action for a retryable final transcription', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Transcript needs another pass',
      detail: 'Your recording is safe.',
      actionLabel: 'Retry transcription',
    });
  });

  it('offers a calm, outcome-focused speaker label improvement', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        speakerAttributionFailure: true,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Improve speaker labels',
      detail: 'Pluto can take another pass using the saved recording.',
      actionLabel: 'Improve labels',
    });
  });

  it('explains a completed label attempt without presenting it as a fresh retry', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        speakerAttributionFailure: true,
        speakerAttributionAttempted: true,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Speaker labels could not be improved',
      detail:
        'Pluto kept your previous transcript because this pass could not verify enough speaker labels.',
      actionLabel: null,
    });
  });

  it('explains when a retry paused to protect system resources', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
        speakerAttributionFailure: false,
        resourcePolicyDenied: true,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Transcription paused',
      detail:
        'Your Mac was too busy or warm to retry safely. Try again when system load drops.',
      actionLabel: 'Retry transcription',
    });
  });

  it('keeps capture recovery honest when a retry would be unsafe', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: false,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: true,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Recording saved',
      detail: "Pluto couldn't finish the transcript. Your recording is safe.",
      actionLabel: null,
    });
  });

  it('uses the same pattern for a partial transcript without inventing a retry', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: false,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: true,
        hasExistingAnalysis: false,
        downstreamFailed: false,
      }),
    ).toEqual({
      title: 'Partial transcript',
      detail: 'Some captured audio is missing from this transcript.',
      actionLabel: null,
    });
  });

  it('offers analysis retry only after the transcript is ready', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: false,
        speakerAttributionFailure: false,
        resourcePolicyDenied: false,
        captureRecoveryRequired: false,
        captureGap: false,
        hasExistingAnalysis: false,
        downstreamFailed: true,
      }),
    ).toEqual({
      title: 'Analysis needs another pass',
      detail: 'Your transcript is ready.',
      actionLabel: 'Retry analysis',
    });
  });
});

describe('meeting retry progress presentation', () => {
  it.each([
    [
      'speaker_labels',
      {
        title: 'Improve speaker labels',
        detail: 'Pluto can take another pass using the saved recording.',
        loadingLabel: 'Improving labels',
      },
    ],
    [
      'transcript',
      {
        title: 'Transcript needs another pass',
        detail: 'Your recording is safe.',
        loadingLabel: 'Retrying transcription',
      },
    ],
    [
      'analysis',
      {
        title: 'Analysis needs another pass',
        detail: 'Your transcript is ready.',
        loadingLabel: 'Retrying analysis',
      },
    ],
  ] as const)('keeps %s progress stable', (kind, expected) => {
    expect(resolveMeetingRetryProgressPresentation(kind)).toEqual(expected);
  });
});

describe('meeting regeneration failure presentation', () => {
  it('explains a failed local generation without blaming provider settings', () => {
    expect(
      resolveMeetingRegenerationFailurePresentation({
        kind: 'generation_failed',
        issues: ['All per-topic analysis passes failed'],
        hasExistingNotes: true,
      }),
    ).toEqual({
      title: "Notes weren't regenerated",
      detail:
        "The local model didn't finish this pass. Your current notes are unchanged.",
      canRetry: true,
    });
  });

  it('names configuration only when the provider reports configuration evidence', () => {
    expect(
      resolveMeetingRegenerationFailurePresentation({
        kind: 'generation_failed',
        issues: ['OpenAI API key not configured'],
        hasExistingNotes: true,
      }),
    ).toEqual({
      title: "Pluto couldn't reach the configured model",
      detail:
        'Check your model settings, then try again. Your current notes are unchanged.',
      canRetry: true,
    });
  });

  it('gives invalid model output a clear retryable explanation', () => {
    expect(
      resolveMeetingRegenerationFailurePresentation({
        kind: 'invalid_response',
        hasExistingNotes: false,
      }),
    ).toEqual({
      title: "Notes weren't generated",
      detail: "The model returned a response Pluto couldn't use.",
      canRetry: true,
    });
  });
});
