import { describe, expect, it } from 'vitest';

import {
  beginRecordingFinalization,
  buildMeetingTiming,
  collectRecordingArtifactPaths,
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
    });

    expect(cleanup).toEqual(['/tmp/session-system.wav']);
  });

  it('keeps the original system artifact when rebuild fallback is not used', () => {
    const cleanup = resolveFinalizationCleanupPaths({
      primaryAudioPath: '/tmp/session-mic.wav',
      systemAudioPath: '/tmp/session-system.wav',
      rebuiltSystemAudioPath: '',
      mixedAudioPath: '/tmp/session-mix.wav',
    });

    expect(cleanup).toEqual([]);
  });

  it('collects unique non-empty artifact paths for failure cleanup', () => {
    const cleanup = collectRecordingArtifactPaths(
      '/tmp/session-mic.wav',
      '',
      '/tmp/session-system.wav',
      '/tmp/session-mic.wav',
      undefined,
      null,
    );

    expect(cleanup).toEqual([
      '/tmp/session-mic.wav',
      '/tmp/session-system.wav',
    ]);
  });
});
