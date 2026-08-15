import { describe, expect, it } from 'vitest';

import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildRecoverableSealFailureMeeting,
  buildSpeakerAttributionRetryPlan,
  collectDisposableRecordingArtifactPaths,
  createSealedCaptureActivityHandoff,
  getStrongerSpeakerAttributionPolicy,
  planForegroundTranscriptValidation,
  resolveFinalizationCleanupPaths,
  sealCaptureJournalBeforeFinalization,
} from '../../src/utils/recordingFinalization';

describe('recording finalization helpers', () => {
  it('never runs full-session ASR in the foreground after capture stops', () => {
    expect(
      planForegroundTranscriptValidation({
        checkpointEvidenceVerified: true,
      }),
    ).toEqual({
      canonicalMode: 'checkpointed',
      checkpointEvidenceVerified: true,
    });
    expect(
      planForegroundTranscriptValidation({
        checkpointEvidenceVerified: false,
      }),
    ).toEqual({
      canonicalMode: 'checkpointed',
      checkpointEvidenceVerified: false,
    });
  });

  it('invokes validation and every integrity save with the exact sealed evidence', async () => {
    const sealed = await buildCaptureActivityEvidence(
      [{ startTime: 0, endTime: 1, speaker: 'Me' }],
      {
        clock: {
          kind: 'meeting_relative_seconds',
          origin: 'recording_start',
        },
        thresholds: {
          rms: 0.01,
          dominanceRatio: 1.5,
          minimumSwitchIntervalMs: 250,
        },
        algorithmVersion: 'speaker_activity_v1',
      },
    );

    const handoff = createSealedCaptureActivityHandoff(sealed);
    const validate = vi.fn(async () => 'validated');
    const persist = vi.fn(
      async (meeting: Record<string, unknown>) => meeting.id,
    );

    expect(handoff.activityWindows).toBe(sealed.windows);
    expect(handoff.integrity.activityEvidence).toBe(sealed);
    expect(handoff.integrity.activityEvidence.digestSha256).toBe(
      sealed.digestSha256,
    );
    expect(handoff.integrity).toEqual({
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: sealed,
    });

    await expect(handoff.runValidation(validate)).resolves.toBe('validated');
    expect(validate).toHaveBeenCalledWith(sealed.windows);
    expect(validate.mock.calls[0]?.[0]).toBe(sealed.windows);

    for (const id of ['needs-attention', 'pre-analysis', 'final']) {
      await expect(
        handoff.persistMeeting({ id }, { reasons: [] }, persist),
      ).resolves.toBe(id);
    }
    expect(persist).toHaveBeenCalledTimes(3);
    for (const [meeting] of persist.mock.calls) {
      const integrity = JSON.parse(
        String(meeting.transcript_integrity_json),
      ) as {
        activityEvidence: unknown;
        activityEvidenceSource: unknown;
      };
      expect(integrity.activityEvidenceSource).toBe('capture_activity_v2');
      expect(integrity.activityEvidence).toEqual(sealed);
      expect((integrity.activityEvidence as typeof sealed).digestSha256).toBe(
        sealed.digestSha256,
      );
    }
  });

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
      failureReason: 'capture_journal_seal_failed',
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
    expect(JSON.parse(meeting.transcript_integrity_json)).toMatchObject({
      schemaVersion: 2,
      state: 'needs_attention',
      causes: [{ code: 'processing_stage_failed', stage: 'capture_seal' }],
      evidenceProvenance: { kind: 'missing' },
    });
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
      failureReason: 'capture_journal_seal_failed',
    });

    expect(meeting.title).toBe('Meeting');
    expect(meeting.end_reason).toBe('journal_seal_failed');
    expect(meeting).not.toHaveProperty('error');
  });

  it('preserves a content-free journal write failure category', () => {
    const meeting = buildRecoverableSealFailureMeeting({
      snapshot: {
        meetingId: 'meeting-3',
        recordingStartedAtMs: 1_000,
        recordingEndedAtMs: 2_000,
      },
      failureReason: 'capture_journal_write_failed',
    });

    expect(meeting.finalization_error_category).toBe(
      'capture_journal_write_failed',
    );
    expect(meeting.end_reason).toBe('capture_journal_write_failed');
    expect(JSON.parse(meeting.transcript_integrity_json)).toMatchObject({
      schemaVersion: 2,
      state: 'needs_attention',
      causes: [{ code: 'capture_journal_write_failed' }],
      evidenceProvenance: { kind: 'missing' },
    });
  });

  it('drains journal appends before requesting a seal', async () => {
    const events: string[] = [];
    const activityEvidence = await buildCaptureActivityEvidence([], {
      clock: {
        kind: 'meeting_relative_seconds',
        origin: 'recording_start',
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1',
    });
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {
        events.push('drain');
      },
      hasWriteFailure: () => false,
      seal: async () => {
        events.push('seal');
        return { activityEvidence };
      },
    });

    expect(events).toEqual(['drain', 'seal']);
    expect(outcome).toEqual({ status: 'sealed', activityEvidence });
  });

  it('does not seal after a prior write failure', async () => {
    let sealCalls = 0;
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      hasWriteFailure: () => true,
      seal: async () => {
        sealCalls += 1;
        return {};
      },
    });

    expect(sealCalls).toBe(0);
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    });
  });

  it('reduces sensitive seal errors to a content-free recovery category', async () => {
    let sealCalls = 0;
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      hasWriteFailure: () => false,
      seal: async () => {
        sealCalls += 1;
        throw new Error('/private/audio: transcript words');
      },
    });

    expect(sealCalls).toBe(1);
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_seal_failed',
    });
  });

  it('rejects a sealed response without verified activity evidence', async () => {
    let sealCalls = 0;
    const outcome = await sealCaptureJournalBeforeFinalization({
      drainAppends: async () => {},
      hasWriteFailure: () => false,
      seal: async () => {
        sealCalls += 1;
        return {};
      },
    });

    expect(sealCalls).toBe(1);
    expect(outcome).toEqual({
      status: 'recovery_required',
      reason: 'capture_journal_seal_failed',
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

  it('does not vary the fixed preview policy for speaker attribution', () => {
    expect(
      getStrongerSpeakerAttributionPolicy({
        backend: 'mlx_preview',
        preset: 'balanced',
        model: 'small',
        device: 'mlx',
        computeType: 'float16',
        language: 'en',
      }),
    ).toBeNull();
  });

  it('does not request a stronger speaker-attribution policy when already strongest', () => {
    expect(
      getStrongerSpeakerAttributionPolicy({
        backend: 'mlx_preview',
        preset: 'accuracy_first',
        model: 'large-v3',
        device: 'mlx',
        computeType: 'float16',
        language: 'en',
      }),
    ).toBeNull();
  });

  it('does not retry attribution by changing the fixed preview policy', () => {
    expect(
      buildSpeakerAttributionRetryPlan({
        diarizationEnabled: true,
        mappingConfident: false,
        retryAlreadyUsed: false,
        settings: {
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'small',
          device: 'mlx',
          computeType: 'float16',
          language: 'en',
        },
      }),
    ).toEqual({
      shouldRetry: false,
      reason: 'no-stronger-policy',
      strongerOptions: null,
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
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'small',
          device: 'mlx',
          computeType: 'float16',
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
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'small',
          device: 'mlx',
          computeType: 'float16',
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
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'small',
          device: 'mlx',
          computeType: 'float16',
          language: 'en',
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      reason: 'retry-already-used',
    });
  });
});
