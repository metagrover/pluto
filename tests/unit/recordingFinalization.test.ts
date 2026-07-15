import { describe, expect, it } from 'vitest';

import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildSpeakerAttributionRetryPlan,
  collectDisposableRecordingArtifactPaths,
  getStrongerSpeakerAttributionPolicy,
  resolveFinalizationCleanupPaths,
} from '../../src/utils/recordingFinalization';

describe('recording finalization helpers', () => {
  it('starts finalization only once per active meeting', () => {
    const first = beginRecordingFinalization({
      meetingId: 'meeting-1',
      stopInFlight: false,
      recordingStartedAtMs: 1_000,
      nowMs: 5_500,
    });

    expect(first).toEqual({
      meetingId: 'meeting-1',
      recordingStartedAtMs: 1_000,
      recordingEndedAtMs: 5_500,
    });

    const second = beginRecordingFinalization({
      meetingId: 'meeting-1',
      stopInFlight: true,
      recordingStartedAtMs: 1_000,
      nowMs: 9_000,
    });

    expect(second).toBeNull();
  });

  it('freezes meeting timing at the stop request time', () => {
    const timing = buildMeetingTiming({
      recordingStartedAtMs: Date.parse('2026-05-09T20:00:00.000Z'),
      recordingEndedAtMs: Date.parse('2026-05-09T20:17:42.900Z'),
    });

    expect(timing).toEqual({
      startedAtIso: '2026-05-09T20:00:00.000Z',
      endedAtIso: '2026-05-09T20:17:42.900Z',
      durationSeconds: 1062,
    });
  });

  it('cleans up superseded system audio artifacts after rebuild fallback', () => {
    const cleanup = resolveFinalizationCleanupPaths({
      primaryAudioPath: '/tmp/session-mic.wav',
      systemAudioPath: '/tmp/session-system.wav',
      rebuiltSystemAudioPath: '/tmp/session-system-rebuilt.wav',
      mixedAudioPath: '/tmp/session-mix.wav',
      validationStatus: 'validated',
    });

    expect(cleanup).toEqual(['/tmp/session-system.wav']);
  });

  it('keeps the original system artifact when rebuild fallback is not used', () => {
    const cleanup = resolveFinalizationCleanupPaths({
      primaryAudioPath: '/tmp/session-mic.wav',
      systemAudioPath: '/tmp/session-system.wav',
      rebuiltSystemAudioPath: '',
      mixedAudioPath: '/tmp/session-mix.wav',
      validationStatus: 'validated',
    });

    expect(cleanup).toEqual([]);
  });

  it('preserves every source artifact when validation needs attention', () => {
    const cleanup = resolveFinalizationCleanupPaths({
      primaryAudioPath: '/tmp/session-mic.wav',
      systemAudioPath: '/tmp/session-system.wav',
      rebuiltSystemAudioPath: '/tmp/session-system-rebuilt.wav',
      mixedAudioPath: '/tmp/session-mix.wav',
      validationStatus: 'needs_attention',
    });

    expect(cleanup).toEqual([]);
  });

  it('never treats canonical recording sources as disposable failure artifacts', () => {
    const cleanup = collectDisposableRecordingArtifactPaths({
      primaryAudioPath: '/tmp/session-mic.wav',
      systemAudioPath: '/tmp/session-system.wav',
      rebuiltSystemAudioPath: '/tmp/session-system-rebuilt.wav',
      mixedAudioPath: '/tmp/session-mix.wav',
    });

    expect(cleanup).toEqual([]);
  });

  it('returns a stronger speaker-attribution policy when current settings are weaker', () => {
    expect(
      getStrongerSpeakerAttributionPolicy({
        backend: 'whisperx_current',
        preset: 'balanced',
        model: 'small',
        device: 'cpu',
        computeType: 'int8',
        language: 'en',
      }),
    ).toMatchObject({
      backend: 'whisperx_tuned',
      preset: 'accuracy_first',
      model: 'large-v3',
      computeType: 'float32',
    });
  });

  it('does not request a stronger speaker-attribution policy when already strongest', () => {
    expect(
      getStrongerSpeakerAttributionPolicy({
        backend: 'whisperx_tuned',
        preset: 'accuracy_first',
        model: 'large-v3',
        device: 'cpu',
        computeType: 'float32',
        language: 'en',
      }),
    ).toBeNull();
  });

  it('retries low-confidence speaker attribution only when a stronger policy exists', () => {
    expect(
      buildSpeakerAttributionRetryPlan({
        diarizationEnabled: true,
        mappingConfident: false,
        retryAlreadyUsed: false,
        settings: {
          backend: 'whisperx_current',
          preset: 'balanced',
          model: 'small',
          device: 'cpu',
          computeType: 'int8',
          language: 'en',
        },
      }),
    ).toMatchObject({
      shouldRetry: true,
      reason: 'retry-with-stronger-policy',
      strongerOptions: {
        backend: 'whisperx_tuned',
        preset: 'accuracy_first',
      },
    });
  });

  it('skips the retry when mapping is already confident or the stronger pass already ran', () => {
    expect(
      buildSpeakerAttributionRetryPlan({
        diarizationEnabled: true,
        mappingConfident: true,
        retryAlreadyUsed: false,
        settings: {
          backend: 'whisperx_current',
          preset: 'balanced',
          model: 'small',
          device: 'cpu',
          computeType: 'int8',
          language: 'en',
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      reason: 'mapping-confident',
    });

    expect(
      buildSpeakerAttributionRetryPlan({
        diarizationEnabled: true,
        mappingConfident: false,
        retryAlreadyUsed: true,
        settings: {
          backend: 'whisperx_current',
          preset: 'balanced',
          model: 'small',
          device: 'cpu',
          computeType: 'int8',
          language: 'en',
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      reason: 'retry-already-used',
    });
  });
});
