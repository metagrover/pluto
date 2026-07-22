import { describe, expect, it } from 'vitest';

import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildRecoverableSealFailureMeeting,
  buildSpeakerAttributionRetryPlan,
  collectDisposableRecordingArtifactPaths,
  getStrongerSpeakerAttributionPolicy,
  resolveFinalizationCleanupPaths,
  sealCaptureJournalBeforeFinalization,
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

  it('builds a content-free recovery-required meeting after seal failure', () => {
    const meeting = buildRecoverableSealFailureMeeting({
      snapshot: {
        meetingId: 'meeting-1',
        recordingStartedAtMs: Date.parse('2026-07-22T20:00:00.000Z'),
        recordingEndedAtMs: Date.parse('2026-07-22T20:05:30.000Z'),
      },
      title: 'Design review',
      userNotes: 'Keep this note',
      endReason: 'manual',
    });

    expect(meeting).toMatchObject({
      id: 'meeting-1',
      title: 'Design review',
      meeting_type: 'Recording',
      duration_seconds: 330,
      transcript_status: 'needs_attention',
      finalization_status: 'recovery_required',
      finalization_error_category: 'journal_seal_failed',
      transcript_json: '[]',
      user_notes: 'Keep this note',
      end_reason: 'manual',
    });
    expect(meeting.transcript_integrity_json).toBe(
      JSON.stringify({ reasons: ['journal_seal_failed'] }),
    );
    expect(meeting.audio_path).toBeNull();
    expect(meeting.system_audio_path).toBeNull();
    expect(meeting.mixed_audio_path).toBeNull();
  });

  it('uses stable fallback metadata for seal failure', () => {
    const meeting = buildRecoverableSealFailureMeeting({
      snapshot: {
        meetingId: 'meeting-2',
        recordingStartedAtMs: 1_000,
        recordingEndedAtMs: 2_000,
      },
    });

    expect(meeting.title).toBe('Meeting');
    expect(meeting.end_reason).toBe('journal_seal_failed');
    expect(meeting).not.toHaveProperty('error');
  });

  it('drains journal appends before requesting a seal', async () => {
    const events: string[] = [];
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {
        events.push('drain');
      },
      seal: async () => {
        events.push('seal');
      },
    });

    expect(events).toEqual(['drain', 'seal']);
    expect(outcome).toBe('sealed');
  });

  it('reduces sensitive seal errors to a recovery-required outcome', async () => {
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      seal: async () => {
        throw new Error('/private/audio: transcript words');
      },
    });

    expect(outcome).toBe('recovery_required');
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

  it('does not retry the pinned local diarizer with unrelated ASR settings', () => {
    expect(
      buildSpeakerAttributionRetryPlan({
        diarizationEnabled: true,
        mappingConfident: false,
        retryAlreadyUsed: false,
        providerHasStrongerPolicy: false,
        settings: {
          backend: 'whisperx_current',
          preset: 'balanced',
          model: 'small',
          device: 'cpu',
          computeType: 'int8',
          language: 'en',
        },
      }),
    ).toMatchObject({ shouldRetry: false, reason: 'no-stronger-policy' });
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
