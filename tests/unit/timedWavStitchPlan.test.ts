import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { planTimedWavStitch } from '../../electron/timedWavStitchPlan';

describe('timed WAV stitch planning', () => {
  it('uses one sequential timeline for contiguous capture intervals', () => {
    expect(
      planTimedWavStitch(
        [
          { path: '/audio/first.wav', startSec: 0, endSec: 18.381 },
          { path: '/audio/second.wav', startSec: 18.381, endSec: 23.421 },
        ],
        5.034667,
      ),
    ).toEqual({
      mode: 'sequential',
      initialDelayMs: 13_346,
      targetDurationSeconds: 23.421,
    });
  });

  it('sorts contiguous intervals before planning', () => {
    expect(
      planTimedWavStitch(
        [
          { path: '/audio/second.wav', startSec: 5, endSec: 10 },
          { path: '/audio/first.wav', startSec: 0, endSec: 5 },
        ],
        5,
      ),
    ).toMatchObject({ mode: 'sequential', initialDelayMs: 0 });
  });

  it.each([
    [
      'gap',
      [
        { path: '/audio/first.wav', startSec: 0, endSec: 5 },
        { path: '/audio/second.wav', startSec: 6, endSec: 10 },
      ],
    ],
    [
      'overlap',
      [
        { path: '/audio/first.wav', startSec: 0, endSec: 5 },
        { path: '/audio/second.wav', startSec: 4, endSec: 10 },
      ],
    ],
  ])('retains sparse reconstruction for an interior %s', (_name, segments) => {
    expect(planTimedWavStitch(segments, 5)).toEqual({ mode: 'sparse' });
  });

  it('uses the sequential plan through one concat input in Electron', () => {
    const source = readFileSync('electron/main.ts', 'utf8');
    expect(source).toContain('planTimedWavStitch(');
    expect(source).toContain("'-f concat'");
    expect(source).toContain("plan.mode === 'sequential'");
  });
});
