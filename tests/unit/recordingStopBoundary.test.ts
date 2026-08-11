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

  it('admits the MediaRecorder final interval before closing the live queue', () => {
    const recorderStop = stopSession.indexOf(
      'const micBlob = await stopRecorder(',
    );
    const captureDrain = stopSession.indexOf(
      'await captureActivitySessionRef.current?.drain();',
    );
    const queueClose = stopSession.indexOf(
      'liveQueueAtStop.close({ drainQueued: true })',
    );

    expect(recorderStop).toBeGreaterThan(-1);
    expect(captureDrain).toBeGreaterThan(recorderStop);
    expect(queueClose).toBeGreaterThan(captureDrain);
  });

  it('bounds final-interval draining before fencing and cancellation', () => {
    const queueClose = stopSession.indexOf(
      'liveQueueAtStop.close({ drainQueued: true })',
    );
    const boundedWait = stopSession.indexOf(
      'await liveQueueAtStop.waitForIdle(2_500)',
      queueClose,
    );
    const generationFence = stopSession.indexOf(
      'liveTranscriptionGenerationRef.current += 1',
      queueClose,
    );
    const cancellation = stopSession.indexOf(
      "'CANCEL_MEETING_TRANSCRIPTION'",
      queueClose,
    );

    expect(boundedWait).toBeGreaterThan(queueClose);
    expect(generationFence).toBeGreaterThan(boundedWait);
    expect(cancellation).toBeGreaterThan(generationFence);
  });
});
