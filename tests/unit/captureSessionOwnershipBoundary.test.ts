import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sliceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('capture session production ownership boundary', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  const audioManager = readFileSync('src/components/AudioManager.tsx', 'utf8');

  it('acquires before journal creation and releases at stop or seal', () => {
    const startHandler = sliceBetween(
      main,
      "'AUDIO_CAPTURE_JOURNAL_START'",
      "'AUDIO_CAPTURE_JOURNAL_READ'",
    );
    const stopHandler = sliceBetween(
      main,
      "'AUDIO_CAPTURE_JOURNAL_STOP'",
      "'AUDIO_CAPTURE_JOURNAL_SEAL'",
    );
    const sealHandler = sliceBetween(
      main,
      "'AUDIO_CAPTURE_JOURNAL_SEAL'",
      '// --- NATIVE AUDIO CAPTURE',
    );

    expect(main).toContain('createCaptureSessionLeaseRegistry()');
    expect(startHandler).toContain('captureSessionLease.acquire(');
    expect(startHandler.indexOf('captureSessionLease.acquire(')).toBeLessThan(
      startHandler.indexOf('createCaptureJournal('),
    );
    expect(startHandler).toContain('captureSessionLease.release(');
    expect(stopHandler).toContain('captureSessionLease.release(');
    expect(sealHandler).toContain('captureSessionLease.release(');
  });

  it('routes native audio only to the renderer that owns the lease', () => {
    const nativeStartHandler = sliceBetween(
      main,
      "'NATIVE_AUDIO_START'",
      "'NATIVE_AUDIO_STOP'",
    );
    const nativeStopHandler = sliceBetween(
      main,
      "'NATIVE_AUDIO_STOP'",
      "'AUDIO_SAVE_AND_CONVERT'",
    );

    expect(nativeStartHandler).toContain('activeForOwner(');
    expect(nativeStartHandler).toContain(
      "captureOwner.send('NATIVE_AUDIO_CHUNK', chunk)",
    );
    expect(nativeStartHandler).toContain(
      'nativeAudioProcess === spawnedProcess',
    );
    expect(nativeStartHandler).not.toContain(
      "win.webContents.send('NATIVE_AUDIO_CHUNK', chunk)",
    );
    expect(nativeStopHandler).toContain(
      'nativeAudioOwner.id !== event.sender.id',
    );
  });

  it('releases an owner whose webContents is destroyed', () => {
    expect(main).toContain("owner.once('destroyed'");
    expect(main).toContain('captureSessionLease.releaseOwner(owner.id)');
  });

  it('hard-rejects lease conflicts before microphone acquisition', () => {
    const startSession = sliceBetween(
      audioManager,
      'const startSession = async () =>',
      'const stopSession = async (',
    );
    const conflictIndex = startSession.indexOf(
      'isCaptureSessionAlreadyActiveError(journalErr)',
    );
    const conflictReturnIndex = startSession.indexOf('return;', conflictIndex);
    const microphoneIndex = startSession.indexOf(
      'navigator.mediaDevices.getUserMedia',
    );

    expect(conflictIndex).toBeGreaterThan(-1);
    expect(conflictReturnIndex).toBeGreaterThan(conflictIndex);
    expect(conflictReturnIndex).toBeLessThan(microphoneIndex);
    expect(startSession.indexOf('onRecordingStarted?.(')).toBeGreaterThan(
      startSession.indexOf("'AUDIO_CAPTURE_JOURNAL_START'"),
    );
  });

  it('prevents renderer unload while capture work is active', () => {
    expect(audioManager).toContain("window.addEventListener('beforeunload'");
    expect(audioManager).toContain('shouldPreventCaptureUnload({');
    expect(audioManager).toContain('recording: isRecordingRef.current');
    expect(audioManager).toContain('processing: isProcessingRef.current');
    expect(main).toContain("win.webContents.on('will-prevent-unload'");
  });
});
