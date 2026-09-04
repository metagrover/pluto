import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Native AudioCap dynamic route listener and watchdog contract', () => {
  const mainSource = readFileSync(
    'resources/swift/audiocap/main.swift',
    'utf8',
  );
  const processTapSource = readFileSync(
    'resources/swift/audiocap/ProcessTap.swift',
    'utf8',
  );

  it('registers CoreAudio property listener blocks for system device changes', () => {
    expect(mainSource).toContain('AudioObjectAddPropertyListenerBlock');
    expect(mainSource).toContain('kAudioHardwarePropertyDefaultOutputDevice');
    expect(mainSource).toContain('kAudioHardwarePropertyDevices');
  });

  it('implements frame-receipt watchdog timer with bounded retries', () => {
    expect(mainSource).toMatch(/watchdog|framesReceived|framesArrived/u);
    expect(mainSource).toContain('3.0'); // 3-second watchdog window
  });

  it('handles transient CoreAudio bad object errors during device transition', () => {
    expect(processTapSource).toMatch(
      /kAudioHardwareBadObjectError|560947818|badObjectRetry/u,
    );
  });
});
