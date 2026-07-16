import { describe, expect, it } from 'vitest';
import {
  buildRecordingWorkspaceModel,
  withCaptureDurabilityWarning,
} from '../../src/components/features/recordingWorkspaceModel';

describe('buildRecordingWorkspaceModel', () => {
  it('keeps healthy capture calm while exposing transcript state', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 62_000,
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

  it('names the input that needs attention', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 2_000,
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
