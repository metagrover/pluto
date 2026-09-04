import { execFileSync } from 'node:child_process';
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

  it('suppresses device change triggers during self-initiated aggregate rebuilds to prevent loops', () => {
    expect(mainSource).toMatch(
      /isSelfModifyingDevices|isRebuildingTap|suppressDeviceChange/u,
    );
  });

  it('tracks frames per tap generation so post-switch silent taps trigger watchdog recovery', () => {
    expect(mainSource).toMatch(
      /tapFramesReceived|tapGeneration|currentTapFrames/u,
    );
  });

  it('normalizes native tap output to fixed 48kHz Float32 PCM', () => {
    expect(mainSource).toContain('48000');
    expect(mainSource).toMatch(
      /normalizeTo48k|resampleTo48k|outputSampleRate\s*=\s*48000|AudioStreamer|targetSampleRate\s*=\s*48000/u,
    );
  });

  it('bounds watchdog retries and resets only on external route changes or active frames', () => {
    // restartTap should accept a parameter or only reset retries when route changed externally
    expect(mainSource).toMatch(/restartTap\(\s*isExternalRouteChange/u);
    // When watchdog fires restartTap, isExternalRouteChange is false
    expect(mainSource).toContain(
      'self.restartTap(isExternalRouteChange: false)',
    );
    expect(mainSource).toContain(
      'self.restartTap(isExternalRouteChange: true)',
    );
  });

  it('detects stream stall where frames arrived previously but stopped flowing for 3.0s', () => {
    expect(mainSource).toMatch(/elapsedSinceLastFrame\s*>=\s*3\.0/u);
    expect(mainSource).toMatch(/isStalled|stream stalled/u);
  });

  it('serializes watchdog frame counters on controlQueue and guards against stale generation callbacks', () => {
    expect(mainSource).toMatch(/controlQueue\.async/u);
    expect(mainSource).toMatch(/self\.tapGeneration\s*==\s*currentGeneration/u);
  });

  it('rejects out-of-band frequencies (executable stopband test) in native AudioStreamer', () => {
    const streamerSource = readFileSync(
      'resources/swift/audiocap/AudioStreamer.swift',
      'utf8',
    );
    expect(streamerSource).toContain('sinc');
    expect(streamerSource).toMatch(/cutoff|filterRadius|Blackman/u);

    // Executable test on compiled binary
    const binOutput = execFileSync(
      'resources/bin/audiocap',
      ['--test-stopband'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(binOutput.trim().split('\n').pop()!);
    expect(parsed.status).toBe('ok');
    expect(parsed.stopbandRms).toBeLessThan(0.05);
    expect(parsed.passbandRms).toBeGreaterThan(0.65);
  });
});
