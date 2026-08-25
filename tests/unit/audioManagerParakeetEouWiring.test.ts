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

  it('materializes sealed system audio for canonical final transcription', () => {
    const sealIndex = source.indexOf('sealCaptureJournalBeforeFinalization({');
    const materializeIndex = source.indexOf(
      "'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE'",
    );
    const saveIndex = source.indexOf("'SAVE_MEETING'", materializeIndex);
    expect(materializeIndex).toBeGreaterThan(sealIndex);
    expect(saveIndex).toBeGreaterThan(materializeIndex);
  });

  it('keeps the active EOU session across ordinary AudioManager rerenders', () => {
    const listenerEffectStart = source.indexOf(
      '// Set up event listeners for external control',
    );
    const listenerEffectEnd = source.indexOf(
      '// Expose stopSession and startSession to parent via refs',
      listenerEffectStart,
    );
    const listenerEffect = source.slice(listenerEffectStart, listenerEffectEnd);

    expect(listenerEffect).toContain('startSessionActionRef.current()');
    expect(listenerEffect).toContain('stopSessionActionRef.current()');
    expect(listenerEffect).toMatch(
      /return \(\) => \{[\s\S]*?\n {2}\}, \[\]\);/u,
    );
  });

  it('claims a synchronous start lock before asynchronous readiness', () => {
    const startIndex = source.indexOf('const startSession = async () => {');
    const guardIndex = source.indexOf('startInFlightRef.current', startIndex);
    const claimIndex = source.indexOf(
      'startInFlightRef.current = true',
      guardIndex,
    );
    const readinessIndex = source.indexOf(
      "'RECORDING_READINESS_STATUS'",
      claimIndex,
    );
    const releaseIndex = source.indexOf(
      'startInFlightRef.current = false',
      readinessIndex,
    );

    expect(guardIndex).toBeGreaterThan(startIndex);
    expect(claimIndex).toBeGreaterThan(guardIndex);
    expect(claimIndex).toBeLessThan(readinessIndex);
    expect(releaseIndex).toBeGreaterThan(readinessIndex);
  });

  it('contains no recording-time MLX transcription machinery', () => {
    expect(source).not.toContain('LiveTranscriptionQueue');
    expect(source).not.toContain('resolveLiveChunkModel');
    expect(source).not.toContain('resolveLiveChunkComputeType');
    expect(source).not.toContain('TRANSCRIPTION_TRANSCRIBE_PREVIEW');
  });
});
