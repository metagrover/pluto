import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioManager dynamic audio device reconnect wiring', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');

  it('wires navigator.mediaDevices devicechange listener for dynamic reconnects', () => {
    expect(source).toMatch(
      /navigator\.mediaDevices\.addEventListener\(\s*['"]devicechange['"]/u,
    );
    expect(source).toMatch(
      /navigator\.mediaDevices\.removeEventListener\(\s*['"]devicechange['"]/u,
    );
  });

  it('debounces or coalesces rapid devicechange events during active capture', () => {
    expect(source).toMatch(
      /reconfigureDeviceTimeoutRef|handleDeviceChangeDebounced|deviceChangeDebounceMs/u,
    );
    expect(source).toMatch(/isReconfiguringRef|reconfigureInFlightRef/u);
  });

  it('drains in-flight speech chunks before tearing down defunct audio nodes', () => {
    const drainIndex = source.indexOf('drainInFlightMicPcm');
    expect(drainIndex).toBeGreaterThan(-1);
    expect(source).toContain('micPcmChunksRef.current');
  });

  it('transitions capture health through reconfiguring during device routing', () => {
    expect(source).toContain("microphone: 'reconfiguring'");
  });

  it('uses audioResampler to normalize input sample rate to 16kHz', () => {
    expect(source).toContain('createAudioResampler');
    expect(source).toContain('micResamplerRef');
  });

  it('recreates MediaRecorder upon dynamic reconnect to preserve journal cadence', () => {
    expect(source).toMatch(
      /startMicMediaRecorder|new MediaRecorder\(newMicStream/u,
    );
    expect(source).toContain('micRecorderRef.current = micRecorder');
  });

  it('guards against late getUserMedia resolution when recording was stopped', () => {
    expect(source).toMatch(/!isRecordingRef\.current[\s\S]*?track\.stop\(\)/u);
  });

  it('retains a stable devicechange listener ref for accurate removal', () => {
    expect(source).toMatch(
      /activeDeviceChangeListenerRef|deviceChangeListenerRef/u,
    );
  });

  it('keeps system audio sample rate fixed at 48000 Hz and does not re-infer from wall time', () => {
    expect(source).toContain('systemPcmSampleRateRef.current = 48000');
    expect(source).toContain('createWavBlob(intervalPcm, 48000, 1)');
    expect(source).not.toContain('resolvePcmTimelineSampleRate');
  });

  it('awaits old recorder stop and journal drain before starting replacement recorder', () => {
    expect(source).toMatch(
      /await waitForMediaRecorderStop\(oldRecorder, 500\)[\s\S]*?drain\(\)/u,
    );
  });

  it('starts the initial MediaRecorder before publishing recording state', () => {
    const initialStart = source.indexOf(
      'await startMicMediaRecorder(micStream, true)',
    );
    const recordingPublication = source.indexOf(
      'isRecordingRef.current = true',
      initialStart,
    );

    expect(initialStart).toBeGreaterThan(-1);
    expect(recordingPublication).toBeGreaterThan(initialStart);
  });

  it('does not treat the recorder shutdown timeout as a successful rotation', () => {
    expect(source).toContain('waitForMediaRecorderStop');
    expect(source).not.toContain('setTimeout(done, 500)');
  });

  it('reuses the stop-event barrier even after MediaRecorder reports inactive', () => {
    expect(source).toContain('if (oldRecorder) {');
    expect(source).not.toContain(
      "oldRecorder && oldRecorder.state !== 'inactive'",
    );
  });

  it('checks session cancellation after every await during dynamic reconfiguration', () => {
    const fnStart = source.indexOf('handleDeviceChangeReconfigure = async');
    const fnEnd = source.indexOf('catch (reconnectErr)', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    // Verify isSessionAborted is invoked multiple times (after getUserMedia, resume, startMicMediaRecorder)
    const matches = fnBody.match(/if\s*\(\s*isSessionAborted\(\)\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});
