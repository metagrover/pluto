import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioManager Parakeet EOU wiring', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');

  it('creates and starts the EOU session before microphone acquisition', () => {
    const createIndex = source.indexOf('createEouRendererSession({');
    const startIndex = source.indexOf('await eouSession.start()');
    const microphoneIndex = source.indexOf(
      'navigator.mediaDevices.getUserMedia',
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(createIndex);
    expect(startIndex).toBeLessThan(microphoneIndex);
  });

  it('feeds copied mic PCM and decoded System PCM into EOU', () => {
    expect(source).toContain('const copied = new Float32Array(input)');
    expect(source).toContain("eouSessionRef.current?.append('mic', copied)");
    expect(source).toContain(
      "eouSessionRef.current?.append('system', decoded.samples)",
    );
  });

  it('finishes EOU before capture stop and canonical finalization', () => {
    const finishIndex = source.indexOf('await eouSessionAtStop?.finish()');
    const captureStopIndex = source.indexOf("'AUDIO_CAPTURE_JOURNAL_STOP'");
    expect(finishIndex).toBeGreaterThan(-1);
    expect(finishIndex).toBeLessThan(captureStopIndex);
  });

  it('contains no recording-time MLX transcription machinery', () => {
    expect(source).not.toContain('LiveTranscriptionQueue');
    expect(source).not.toContain('resolveLiveChunkModel');
    expect(source).not.toContain('resolveLiveChunkComputeType');
    expect(source).not.toContain('TRANSCRIPTION_TRANSCRIBE_PREVIEW');
  });
});
