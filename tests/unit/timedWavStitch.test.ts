import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stitchTimedWavSegments } from '../../electron/timedWavStitch';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pluto-stitch-test-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// Write actual float WAV input, including changing rates/channels from a route switch.
function chunk(
  name: string,
  rate: number,
  duration: number,
  pulseAt: number,
  channels = 1,
  pulseAmplitude = 0.3,
) {
  const frames = Math.round(rate * duration);
  const wav = Buffer.alloc(44 + frames * channels * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * channels * 4, 28);
  wav.writeUInt16LE(channels * 4, 32);
  wav.writeUInt16LE(32, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < frames; i++) {
    const amplitude =
      i / rate >= pulseAt && i / rate < pulseAt + 0.04 ? pulseAmplitude : 0;
    for (let c = 0; c < channels; c++)
      wav.writeFloatLE(amplitude, 44 + (i * channels + c) * 4);
  }
  const file = path.join(root, name);
  writeFileSync(file, wav);
  return file;
}
const probeAudioDuration = async (file: string) =>
  Number(
    execFileSync(
      ffprobeStatic.path,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { encoding: 'utf8' },
    ).trim(),
  );
const stitch = (
  segments: Array<{ path?: string; startSec?: number; endSec?: number }>,
) =>
  stitchTimedWavSegments({
    segments,
    outputDir: path.join(root, 'output'),
    tempDir: root,
    probeAudioDuration,
  });
function samples(file: string) {
  const bytes = execFileSync(ffmpegStatic!, [
    '-v',
    'error',
    '-i',
    file,
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    '16000',
    'pipe:1',
  ]);
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}
const level = (audio: number[], start: number, duration = 0.02) =>
  audio
    .slice(Math.round(start * 16000), Math.round((start + duration) * 16000))
    .reduce((total, x) => total + Math.abs(x), 0) /
  Math.round(duration * 16000);

describe('real timed WAV reconstruction', () => {
  it('keeps pulses and late content at their original times across 32/48/44.1/48 kHz switches', async () => {
    const rates = [32000, 48000, 44100, 48000];
    const segments = rates.map((rate, i) => ({
      path: chunk(`${i}.wav`, rate, 0.5, 0.3),
      startSec: i * 0.5,
      endSec: (i + 1) * 0.5,
    }));
    const output = await stitch(segments);
    expect(output).not.toBeNull();
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(2, 3);
    for (const time of [0.31, 0.81, 1.31, 1.81])
      expect(level(audio, time), `pulse at ${time}s`).toBeGreaterThan(0.25);
    expect(level(audio, 1.1)).toBeLessThan(0.001);
    expect(
      readdirSync(root).filter((name) => name.startsWith('pluto-audio-')),
    ).toEqual([]);
  });

  it('keeps every contiguous chunk end-aligned and pads to the journal duration', async () => {
    const output = await stitch([
      { path: chunk('first.wav', 32000, 0.5, 0.1), startSec: 0.2, endSec: 1 },
      {
        path: chunk('second.wav', 48000, 0.5, 0.3, 2),
        startSec: 1,
        endSec: 1.6,
      },
    ]);
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(1.6, 3);
    expect(level(audio, 0.4)).toBeLessThan(0.001);
    expect(level(audio, 0.61)).toBeGreaterThan(0.25);
    expect(level(audio, 1.31)).toBeLessThan(0.001);
    expect(level(audio, 1.41)).toBeGreaterThan(0.25);
    expect(level(audio, 1.55)).toBeLessThan(0.001);
  });

  it('does not accumulate route gaps across contiguous journal intervals', async () => {
    const output = await stitch([
      { path: chunk('a.wav', 24000, 0.5, 0.1), startSec: 0, endSec: 0.5 },
      { path: chunk('b.wav', 16000, 0.2, 0.1), startSec: 0.5, endSec: 1 },
      { path: chunk('c.wav', 48000, 0.4, 0.2), startSec: 1, endSec: 1.5 },
      { path: chunk('d.wav', 44100, 0.5, 0.3), startSec: 1.5, endSec: 2 },
    ]);
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(2, 3);
    for (const time of [0.11, 0.91, 1.31, 1.81])
      expect(level(audio, time), `journal pulse at ${time}s`).toBeGreaterThan(
        0.25,
      );
    for (const time of [0.61, 1.01, 1.41])
      expect(
        level(audio, time),
        `no accumulated drift at ${time}s`,
      ).toBeLessThan(0.001);
  });

  it('preserves audio exceeding an interior journal interval without shifting the next chunk', async () => {
    const output = await stitch([
      { path: chunk('long.wav', 32000, 0.6, 0.55), startSec: 0, endSec: 0.5 },
      { path: chunk('next.wav', 48000, 0.5, 0.2), startSec: 0.5, endSec: 1 },
    ]);
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(1, 3);
    expect(level(audio, 0.56)).toBeGreaterThan(0.25);
    expect(level(audio, 0.71)).toBeGreaterThan(0.25);
    expect(level(audio, 0.81)).toBeLessThan(0.001);
  });

  it('retains absolute offsets, silence gaps, and additive overlaps for sparse intervals', async () => {
    const output = await stitch([
      { path: chunk('a.wav', 32000, 0.5, 0.3), startSec: 0.2, endSec: 0.7 },
      { path: chunk('b.wav', 48000, 0.5, 0.1), startSec: 0.4, endSec: 0.9 },
      { path: chunk('c.wav', 44100, 0.5, 0.3), startSec: 1.4, endSec: 1.9 },
    ]);
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(1.9, 3);
    expect(level(audio, 0.51)).toBeGreaterThan(0.55);
    expect(level(audio, 1.1)).toBeLessThan(0.001);
    expect(level(audio, 1.71)).toBeGreaterThan(0.25);
  });

  it('preserves additive overlap across more than one mix batch without intermediate clipping', async () => {
    const segments = Array.from({ length: 17 }, (_, i) => ({
      path: chunk(
        `${i}.wav`,
        i % 2 ? 48000 : 32000,
        0.1,
        0.03,
        1,
        i === 16 ? -0.9 : 0.1,
      ),
      startSec: 0.2,
      endSec: 0.3,
    }));
    const output = await stitch(segments);
    const audio = samples(output!);
    expect(audio.length / 16000).toBeCloseTo(0.3, 3);
    expect(level(audio, 0.24)).toBeCloseTo(0.7, 3);
    expect(
      readdirSync(root).filter((name) => name.startsWith('pluto-audio-')),
    ).toEqual([]);
  });

  it('returns null for empty, missing, or invalid segments', async () => {
    expect(await stitch([])).toBeNull();
    expect(
      await stitch([
        { path: path.join(root, 'missing.wav'), startSec: 0, endSec: 1 },
      ]),
    ).toBeNull();
    expect(
      await stitch([
        {
          path: chunk('valid.wav', 32000, 0.5, 0.1),
          startSec: Number.NaN,
          endSec: 1,
        },
      ]),
    ).toBeNull();
  });

  it('cleans temporary files and partial output after an undecodable later chunk', async () => {
    const corrupt = path.join(root, 'corrupt.wav');
    writeFileSync(corrupt, 'not audio');
    expect(
      await stitch([
        { path: chunk('valid.wav', 32000, 0.5, 0.1), startSec: 0, endSec: 0.5 },
        { path: corrupt, startSec: 0.5, endSec: 1 },
      ]),
    ).toBeNull();
    expect(readdirSync(path.join(root, 'output'))).toEqual([]);
    expect(
      readdirSync(root).filter((name) => name.startsWith('pluto-audio-')),
    ).toEqual([]);
  });
  it('rejects partially missing or invalid inputs instead of publishing a truncated recording', async () => {
    const valid = {
      path: chunk('valid.wav', 32000, 0.5, 0.1),
      startSec: 0,
      endSec: 0.5,
    };
    expect(
      await stitch([
        valid,
        { path: path.join(root, 'missing.wav'), startSec: 0.5, endSec: 1 },
      ]),
    ).toBeNull();
    expect(
      await stitch([valid, { ...valid, startSec: Number.NaN }]),
    ).toBeNull();
  });
});
