import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import {
  createSpeakerEnrollmentAudio,
  planSpeakerEnrollmentAudio,
} from '../../electron/speakerEnrollmentAudio';

describe('speakerEnrollmentAudio', () => {
  it('builds a bounded two-sample clip separated by silence', () => {
    const plan = planSpeakerEnrollmentAudio([
      { startSec: 71.76, endSec: 79.76, excerpt: 'First sample' },
      { startSec: 1090, endSec: 1093.04, excerpt: 'Second sample' },
    ]);

    expect(plan).toEqual({
      filter:
        '[0:a]atrim=start=0:duration=8,asetpts=PTS-STARTPTS[s0];' +
        '[1:a]atrim=start=0:duration=3.04,asetpts=PTS-STARTPTS[s1];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap0];' +
        '[s0][gap0][s1]concat=n=3:v=0:a=1[out]',
      inputSeeks: [71.76, 1090],
      totalDurationSeconds: 12.04,
    });
  });

  it('accepts one valid interval and rejects invalid intervals', () => {
    expect(planSpeakerEnrollmentAudio([])).toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 1, endSec: 3, excerpt: 'Only one sample' },
      ]),
    ).not.toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 5, endSec: 4, excerpt: 'Invalid' },
        { startSec: 10, endSec: 13, excerpt: 'Valid' },
      ]),
    ).toBeNull();
  });

  it('concatenates multiple enrollment intervals with bounded silence gaps', () => {
    const plan = planSpeakerEnrollmentAudio([
      { startSec: 1, endSec: 5, excerpt: 'First' },
      { startSec: 20, endSec: 25, excerpt: 'Second' },
      { startSec: 40, endSec: 43, excerpt: 'Third' },
    ]);

    expect(plan).toEqual({
      filter:
        '[0:a]atrim=start=0:duration=4,asetpts=PTS-STARTPTS[s0];' +
        '[1:a]atrim=start=0:duration=5,asetpts=PTS-STARTPTS[s1];' +
        '[2:a]atrim=start=0:duration=3,asetpts=PTS-STARTPTS[s2];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap0];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap1];' +
        '[s0][gap0][s1][gap1][s2]concat=n=5:v=0:a=1[out]',
      inputSeeks: [1, 20, 40],
      totalDurationSeconds: 14,
    });
  });

  it('creates bounded system and silent microphone WAVs with the bundled FFmpeg', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'pluto-enrollment-'));
    const sourcePath = path.join(directory, 'source.wav');
    try {
      execFileSync(ffmpegStatic!, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=16000:duration=3',
        sourcePath,
      ]);
      const result = await createSpeakerEnrollmentAudio({
        sourcePath,
        intervals: [
          { startSec: 0.2, endSec: 0.7, excerpt: 'First' },
          { startSec: 1, endSec: 1.5, excerpt: 'Second' },
        ],
        outputDir: directory,
      });

      expect(result).not.toBeNull();
      expect(existsSync(result!.systemPath)).toBe(true);
      expect(existsSync(result!.micPath)).toBe(true);
      for (const outputPath of [result!.systemPath, result!.micPath]) {
        const duration = Number(
          execFileSync(ffprobeStatic.path, [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            outputPath,
          ]).toString(),
        );
        expect(duration).toBeCloseTo(2, 2);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
