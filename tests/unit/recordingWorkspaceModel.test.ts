import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecordingWorkspaceModel,
  resolveSystemCaptureHealth,
  scheduleSystemCaptureTimeout,
} from '../../src/components/features/recordingWorkspaceModel';

describe('buildRecordingWorkspaceModel', () => {
  it('keeps healthy capture calm while exposing transcript state', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 62_000,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [
        {
          id: '1',
          speaker: 'Me',
          text: 'Ship the review.',
          timestampMs: 12_000,
          confirmed: true,
        },
      ],
      interimText: 'Then notify',
    });
    expect(model.elapsedLabel).toBe('01:01');
    expect(model.status).toBe('recording');
    expect(model.needsAttention).toBe(false);
    expect(model.transcript).toHaveLength(1);
  });

  it('names the input that needs attention', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 2_000,
      isProcessing: false,
      microphone: 'warning',
      systemAudio: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
    });
    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toContain('Microphone');
  });

  it('distinguishes transcript lag from microphone capture failure', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 11_000,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      liveTranscriptIntegrity: 'lagging',
      segments: [],
      interimText: '',
    });

    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toBe(
      'Your audio is recording, but live transcription is falling behind',
    );
  });
});

describe('resolveSystemCaptureHealth', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps a started native capture pending until valid PCM arrives', () => {
    expect(
      resolveSystemCaptureHealth({ nativeStarted: true, validPcmSeen: false }),
    ).toBe('warning');
  });

  it('marks a native capture unavailable when startup fails', () => {
    expect(
      resolveSystemCaptureHealth({ nativeStarted: false, validPcmSeen: false }),
    ).toBe('unavailable');
  });

  it('marks system audio healthy after valid PCM arrives', () => {
    expect(
      resolveSystemCaptureHealth({ nativeStarted: true, validPcmSeen: true }),
    ).toBe('healthy');
  });

  it('marks a started capture unavailable when valid PCM times out', () => {
    expect(
      resolveSystemCaptureHealth({
        nativeStarted: true,
        validPcmSeen: false,
        timedOut: true,
      }),
    ).toBe('unavailable');
  });

  it('cancels the pending timeout after valid PCM arrives', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const cancel = scheduleSystemCaptureTimeout(onTimeout, 3_000);

    cancel();
    vi.advanceTimersByTime(3_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
