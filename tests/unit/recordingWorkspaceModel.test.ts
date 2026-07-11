import { describe, expect, it } from 'vitest';
import { buildRecordingWorkspaceModel } from '../../src/components/features/recordingWorkspaceModel';

describe('buildRecordingWorkspaceModel', () => {
  it('keeps healthy capture calm while exposing transcript state', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 62_000,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
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
      segments: [],
      interimText: '',
    });
    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toContain('Microphone');
  });
});
