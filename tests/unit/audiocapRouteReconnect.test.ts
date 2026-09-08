import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const compileAudioCap = () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'pluto-audiocap-test-'));
  const outputPath = join(outputDirectory, 'audiocap');
  const sourceDirectory = 'resources/swift/audiocap';
  const sources = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith('.swift'))
    .map((entry) => join(sourceDirectory, entry));

  execFileSync('xcrun', [
    'swiftc',
    ...sources,
    '-o',
    outputPath,
    '-framework',
    'CoreAudio',
    '-framework',
    'AudioToolbox',
    '-framework',
    'AVFoundation',
  ]);

  return {
    outputPath,
    cleanup: () => rmSync(outputDirectory, { recursive: true, force: true }),
  };
};

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
    const exhaustion = mainSource.slice(
      mainSource.indexOf('Watchdog: exceeded'),
      mainSource.indexOf('} else if', mainSource.indexOf('Watchdog: exceeded')),
    );
    expect(exhaustion).toContain('exit(1)');
  });

  it('detects stream stall where frames arrived previously but stopped flowing for 3.0s', () => {
    expect(mainSource).toMatch(/elapsedSinceLastFrame\s*>=\s*3\.0/u);
    expect(mainSource).toMatch(/isStalled|stream stalled/u);
  });

  it('serializes watchdog frame counters on controlQueue and guards against stale generation callbacks', () => {
    expect(mainSource).toMatch(/controlQueue\.async/u);
    expect(mainSource).toMatch(/self\.tapGeneration\s*==\s*currentGeneration/u);
  });

  it('drops stale tap generations before writing PCM with a generation-local resampler', () => {
    const callbackStart = mainSource.indexOf('private func startTapStreaming');
    const callbackEnd = mainSource.indexOf('@discardableResult', callbackStart);
    const callbackBody = mainSource.slice(callbackStart, callbackEnd);
    const generationGuard = callbackBody.indexOf(
      'self.tapGeneration == currentGeneration',
    );
    const stdoutWrite = callbackBody.indexOf('stdout.write');

    expect(mainSource).toContain(
      'let audioStreamer = AudioStreamer(inputSampleRate: desc.mSampleRate)',
    );
    expect(generationGuard).toBeGreaterThan(-1);
    expect(stdoutWrite).toBeGreaterThan(generationGuard);
  });

  it('prepares PCM from the started aggregate input format and invalidates changed formats', () => {
    const start = processTapSource.indexOf('func start(\n');
    const body = processTapSource.slice(
      start,
      processTapSource.indexOf('func stop()', start),
    );
    expect(body.indexOf('queue.suspend()')).toBeLessThan(
      body.indexOf('AudioDeviceStart('),
    );
    expect(body.indexOf('let format = try readInputFormat()')).toBeGreaterThan(
      body.indexOf('AudioDeviceStart('),
    );
    expect(body).toContain('callback.block = try prepare(format)');
    expect(body).toContain('kAudioStreamPropertyVirtualFormat');
    expect(
      body.indexOf('let confirmedFormat = try? Self.readVirtualFormat(stream)'),
    ).toBeGreaterThan(body.indexOf('AudioObjectAddPropertyListenerBlock'));
    expect(body).toContain('Self.sameCaptureFormat(format, confirmedFormat)');
    expect(body.indexOf('callback.block = nil')).toBeLessThan(
      body.indexOf('onFormatChange()'),
    );
    expect(mainSource).toContain(
      'downmixAudioBuffers(buffers, expectedChannels: desc.mChannelsPerFrame)',
    );
    const listener = mainSource.slice(
      mainSource.indexOf('onFormatChange: {'),
      mainSource.indexOf('}, prepare: {'),
    );
    expect(listener).toContain('self.tapGeneration == currentGeneration');
  });

  it('rolls back a partially started tap when format preparation fails', () => {
    const start = processTapSource.indexOf('func start(\n');
    const body = processTapSource.slice(
      start,
      processTapSource.indexOf('func stop()', start),
    );
    expect(body).toContain('catch {');
    expect(body).toContain('stop()');
    expect(body).toContain('throw error');
  });

  it('rejects out-of-band frequencies (executable stopband test) in native AudioStreamer', () => {
    const streamerSource = readFileSync(
      'resources/swift/audiocap/AudioStreamer.swift',
      'utf8',
    );
    expect(streamerSource).toContain('sinc');
    expect(streamerSource).toMatch(/cutoff|filterRadius|Blackman/u);

    const compiled = compileAudioCap();
    try {
      const binOutput = execFileSync(compiled.outputPath, ['--test-stopband'], {
        encoding: 'utf8',
      });
      const parsed = JSON.parse(binOutput.trim().split('\n').pop()!);
      expect(parsed.status).toBe('ok');
      expect(parsed.stopbandRms).toBeLessThan(0.05);
      expect(parsed.passbandRms).toBeGreaterThan(0.65);
    } finally {
      compiled.cleanup();
    }
  }, 15_000);
});
