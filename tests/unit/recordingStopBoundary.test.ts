import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('recording stop checkpoint boundary', () => {
  const audioManager = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const stopStart = audioManager.indexOf('const stopSession = async (');
  const stopEnd = audioManager.indexOf(
    'useImperativeHandle(ref, () => ({ startSession, stopSession }));',
    stopStart,
  );
  const stopSession = audioManager.slice(stopStart, stopEnd);

  it('admits the MediaRecorder final interval before finishing EOU', () => {
    const recorderStop = stopSession.indexOf(
      'const micBlob = await stopRecorder(',
    );
    const captureDrain = stopSession.indexOf(
      'await captureActivitySessionRef.current?.drain();',
    );
    const eouFinish = stopSession.indexOf('await eouSessionAtStop?.finish()');

    expect(recorderStop).toBeGreaterThan(-1);
    expect(captureDrain).toBeGreaterThan(recorderStop);
    expect(eouFinish).toBeGreaterThan(captureDrain);
  });

  it('drains EOU before fencing and sealing canonical capture', () => {
    const eouFinish = stopSession.indexOf('await eouSessionAtStop?.finish()');
    const generationFence = stopSession.indexOf(
      'eouGenerationRef.current += 1',
      eouFinish,
    );
    const journalStop = stopSession.indexOf(
      "'AUDIO_CAPTURE_JOURNAL_STOP'",
      eouFinish,
    );

    expect(eouFinish).toBeGreaterThan(-1);
    expect(generationFence).toBeGreaterThan(eouFinish);
    expect(journalStop).toBeGreaterThan(generationFence);
  });
});
