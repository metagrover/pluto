import { describe, expect, it } from 'vitest';
import {
  resolveMeetingFailurePresentation,
  resolveMeetingRegenerationFailurePresentation,
} from '../../src/components/features/meetingFailurePresentation';

describe('meeting failure presentation', () => {
  it('offers the only recovery action for a retryable final transcription', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: true,
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

  it('keeps capture recovery honest when a retry would be unsafe', () => {
    expect(
      resolveMeetingFailurePresentation({
        retryableFinalTranscription: false,
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
