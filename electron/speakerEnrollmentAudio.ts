import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import type { SpeakerSampleInterval } from '../src/utils/speakerReview';

const SAMPLE_COUNT = 2;
const SAMPLE_GAP_SECONDS = 1;

export const planSpeakerEnrollmentAudio = (
  intervals: SpeakerSampleInterval[],
): { filter: string; totalDurationSeconds: number } | null => {
  if (
    intervals.length !== SAMPLE_COUNT ||
    intervals.some(
      (interval) =>
        !Number.isFinite(interval.startSec) ||
        !Number.isFinite(interval.endSec) ||
        interval.startSec < 0 ||
        interval.endSec <= interval.startSec,
    )
  ) {
    return null;
  }
  const [first, second] = intervals;
  const filter = `[0:a]atrim=start=${first.startSec}:end=${first.endSec},asetpts=PTS-STARTPTS[s0];[0:a]atrim=start=0:end=${SAMPLE_GAP_SECONDS},volume=0,asetpts=PTS-STARTPTS[gap];[0:a]atrim=start=${second.startSec}:end=${second.endSec},asetpts=PTS-STARTPTS[s1];[s0][gap][s1]concat=n=3:v=0:a=1[out]`;
  const totalDurationSeconds = Number(
    (
      first.endSec -
      first.startSec +
      SAMPLE_GAP_SECONDS +
      second.endSec -
      second.startSec
    ).toFixed(3),
  );
  return { filter, totalDurationSeconds };
};

const saveWav = (command: ffmpeg.FfmpegCommand, outputPath: string) =>
  new Promise<void>((resolve, reject) => {
    command
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .outputOptions(['-xerror', '-threads 1', '-filter_complex_threads 1'])
      .toFormat('wav')
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath);
  });

export const createSpeakerEnrollmentAudio = async (input: {
  sourcePath: string;
  intervals: SpeakerSampleInterval[];
  outputDir: string;
}): Promise<{
  systemPath: string;
  micPath: string;
  totalDurationSeconds: number;
} | null> => {
  const plan = planSpeakerEnrollmentAudio(input.intervals);
  if (!plan || !fs.existsSync(input.sourcePath)) return null;
  fs.mkdirSync(input.outputDir, { recursive: true });
  const token = randomUUID();
  const systemPath = path.join(input.outputDir, `system-${token}.wav`);
  const micPath = path.join(input.outputDir, `mic-${token}.wav`);
  try {
    const systemCommand = ffmpeg(input.sourcePath)
      .complexFilter(plan.filter)
      .outputOptions(['-map [out]']);
    await saveWav(systemCommand, systemPath);
    await saveWav(
      ffmpeg(input.sourcePath).audioFilters([
        `atrim=start=0:end=${plan.totalDurationSeconds}`,
        'volume=0',
        'asetpts=PTS-STARTPTS',
      ]),
      micPath,
    );
    return {
      systemPath,
      micPath,
      totalDurationSeconds: plan.totalDurationSeconds,
    };
  } catch (error) {
    fs.rmSync(systemPath, { force: true });
    fs.rmSync(micPath, { force: true });
    throw error;
  }
};
