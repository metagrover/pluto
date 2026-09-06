import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecordingWorkspaceModel,
  resolveSystemCaptureHealth,
  scheduleSystemCaptureTimeout,
  withCaptureDurabilityWarning,
} from '../../src/components/features/recordingWorkspaceModel';

describe('buildRecordingWorkspaceModel', () => {
  it('shows a finite starting state before capture begins', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: null,
      nowMs: 2_000,
      isStarting: true,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
    });

    expect(model.status).toBe('starting');
    expect(model.elapsedLabel).toBe('00:00');
    expect(model.statusMessage).toBe('Preparing capture');
  });

  it('keeps healthy capture calm while exposing transcript state', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 62_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
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

  it('leaves echo visibility to the transcript presentation boundary', () => {
    const suppressed = {
      id: 'mic-echo',
      speaker: 'Speaker' as const,
      source: 'mic' as const,
      text: 'Please request Docker.',
      timestampMs: 12_000,
      confirmed: true,
      presentation: {
        visibility: 'suppressed_echo' as const,
        matchedSegmentId: 'system-1',
        confidence: 1,
        reason: 'cross_channel_echo' as const,
      },
    };
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 15_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [
        suppressed,
        {
          ...suppressed,
          id: 'system-1',
          source: 'system',
          presentation: undefined,
        },
      ],
      interimText: '',
    });

    expect(model.transcript.map((segment) => segment.id)).toEqual([
      'mic-echo',
      'system-1',
    ]);
    expect(suppressed.presentation.visibility).toBe('suppressed_echo');
  });

  it('keeps distinct tentative speech from both sources visible', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 15_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [
        {
          id: 'mic-tentative',
          speaker: 'Speaker',
          source: 'mic',
          text: 'older tail',
          timestampMs: 12_000,
          confirmed: false,
        },
        {
          id: 'system-tentative',
          speaker: 'Speaker',
          source: 'system',
          text: 'newest tail',
          timestampMs: 13_000,
          confirmed: false,
        },
      ],
      interimText: '',
    });

    expect(model.transcript.map((segment) => segment.id)).toEqual([
      'mic-tentative',
      'system-tentative',
    ]);
  });

  it('passes the stable conversation view beside raw transcript inputs', () => {
    const liveConversation = {
      generation: 1,
      status: 'active' as const,
      rows: [],
      draft: null,
      metrics: {
        corrections: 0,
        restorations: 0,
        lateArrivals: 0,
        degradedReconciliations: 0,
        draftWordCount: 0,
        lastProjectionDurationMs: 0,
      },
    };
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 2_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
      liveConversation,
    });
    expect(model.liveConversation).toBe(liveConversation);
    expect(model.transcript).toEqual([]);
  });

  it('names the input that needs attention', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 2_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'warning',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
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
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'lagging',
      segments: [],
      interimText: '',
    });

    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toBe(
      'Your audio is recording, but live transcription is falling behind',
    );
  });

  it('warns when capture durability is degraded even if audio is still healthy', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 11_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'warning',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
    });

    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toBe(
      'Audio may still be recording, but crash recovery is no longer guaranteed',
    );
  });

  it('reports a calm status during device reconfiguration without triggering error alerts', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 10_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'reconfiguring',
      systemAudio: 'healthy',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
    });

    expect(model.needsAttention).toBe(false);
    expect(model.statusMessage).toBe('Reconfiguring audio devices...');
    expect(model.microphone).toBe('reconfiguring');
  });

  it('reports reconfiguring status when system audio is reconfiguring', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 10_000,
      isStarting: false,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'reconfiguring',
      captureDurability: 'healthy',
      liveTranscriptIntegrity: 'healthy',
      segments: [],
      interimText: '',
    });

    expect(model.needsAttention).toBe(false);
    expect(model.statusMessage).toBe('Reconfiguring audio devices...');
    expect(model.systemAudio).toBe('reconfiguring');
  });
});

describe('withCaptureDurabilityWarning', () => {
  it('marks durability as warning without changing microphone or system-audio health', () => {
    expect(
      withCaptureDurabilityWarning({
        microphone: 'healthy',
        systemAudio: 'warning',
        captureDurability: 'healthy',
      }),
    ).toEqual({
      microphone: 'healthy',
      systemAudio: 'warning',
      captureDurability: 'warning',
    });
  });

  it('keeps an existing durability warning sticky', () => {
    expect(
      withCaptureDurabilityWarning({
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'warning',
      }),
    ).toEqual({
      microphone: 'healthy',
      systemAudio: 'healthy',
      captureDurability: 'warning',
    });
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
