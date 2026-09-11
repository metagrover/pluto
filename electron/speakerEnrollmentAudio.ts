import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import type { SpeakerSampleInterval } from '../src/utils/speakerReview';

const SAMPLE_GAP_SECONDS = 1;

export const planSpeakerEnrollmentAudio = (
  intervals: SpeakerSampleInterval[],
): {
  filter: string;
  inputSeeks: number[];
  totalDurationSeconds: number;
} | null => {
  if (
    intervals.length === 0 ||
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
  const durations = intervals.map((interval) =>
    Number((interval.endSec - interval.startSec).toFixed(3)),
  );
  const sampleFilters = durations.map(
    (duration, index) =>
      `[${index}:a]atrim=start=0:duration=${duration},asetpts=PTS-STARTPTS[s${index}]`,
  );
  const gapFilters = durations
    .slice(1)
    .map(
      (_, index) =>
        `anullsrc=channel_layout=mono:sample_rate=16000:d=${SAMPLE_GAP_SECONDS}[gap${index}]`,
    );
  const concatInputs = durations
    .flatMap((_, index) =>
      index === 0 ? [`[s${index}]`] : [`[gap${index - 1}]`, `[s${index}]`],
    )
    .join('');
  const filter = [
    ...sampleFilters,
    ...gapFilters,
    `${concatInputs}concat=n=${durations.length * 2 - 1}:v=0:a=1[out]`,
  ].join(';');
  const totalDurationSeconds = Number(
    (
      durations.reduce((total, duration) => total + duration, 0) +
      SAMPLE_GAP_SECONDS * Math.max(0, intervals.length - 1)
    ).toFixed(3),
  );
  return {
    filter,
    inputSeeks: intervals.map((interval) => interval.startSec),
    totalDurationSeconds,
  };
};

const saveWav = (
  command: ffmpeg.FfmpegCommand,
  outputPath: string,
  signal?: AbortSignal,
) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('speaker_audio_aborted'));
      return;
    }
    let finished = false;
    const cleanup = () => {
      finished = true;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (finished) return;
      cleanup();
      try {
        command.kill('SIGKILL');
      } catch {}
      reject(new Error('speaker_audio_aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    command
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .outputOptions(['-xerror', '-threads 1', '-filter_complex_threads 1'])
      .toFormat('wav')
      .on('end', () => {
        cleanup();
        resolve();
      })
      .on('error', (err) => {
        cleanup();
        reject(err);
      })
      .save(outputPath);
  });

export const createSpeakerEnrollmentAudio = async (input: {
  sourcePath: string;
  intervals: SpeakerSampleInterval[];
  outputDir: string;
  signal?: AbortSignal;
}): Promise<{
  systemPath: string;
  micPath: string;
  totalDurationSeconds: number;
} | null> => {
  if (input.signal?.aborted) {
    throw new Error('speaker_audio_aborted');
  }
  const plan = planSpeakerEnrollmentAudio(input.intervals);
  if (!plan || !fs.existsSync(input.sourcePath)) return null;
  fs.mkdirSync(input.outputDir, { recursive: true });
  const token = randomUUID();
  const systemPath = path.join(input.outputDir, `system-${token}.wav`);
  const micPath = path.join(input.outputDir, `mic-${token}.wav`);
  try {
    if (input.signal?.aborted) {
      throw new Error('speaker_audio_aborted');
    }
    const systemCommand = ffmpeg();
    for (const seek of plan.inputSeeks) {
      systemCommand.input(input.sourcePath).inputOptions([`-ss ${seek}`]);
    }
    systemCommand.complexFilter(plan.filter).outputOptions(['-map [out]']);
    await saveWav(systemCommand, systemPath, input.signal);
    if (input.signal?.aborted) {
      throw new Error('speaker_audio_aborted');
    }
    await saveWav(
      ffmpeg(input.sourcePath)
        .setStartTime(0)
        .duration(plan.totalDurationSeconds)
        .audioFilters(['volume=0']),
      micPath,
      input.signal,
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
