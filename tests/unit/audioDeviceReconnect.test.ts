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
    expect(source).toMatch(
      /!isRecordingRef\.current[\s\S]*?track\.stop\(\)/u,
    );
  });

  it('retains a stable devicechange listener ref for accurate removal', () => {
    expect(source).toMatch(
      /activeDeviceChangeListenerRef|deviceChangeListenerRef/u,
    );
  });
});
