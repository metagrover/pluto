import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from './ffmpegRunner';
import { type TimedWavSegment, planTimedWavStitch } from './timedWavStitchPlan';

export type TimedWavStitchOptions = {
  segments?: Array<{
    path?: string;
    startSec?: number;
    endSec?: number;
    chunkIndex?: number;
  }>;
  outputTag?: string;
  outputDir: string;
  tempDir: string;
  probeAudioDuration: (inputPath: string) => Promise<number | null>;
};

const MIX_BATCH_SIZE = 16;

const saveWav = (args: string[], outputPath: string, intermediate = false) =>
  runFfmpeg([
    ...args,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    intermediate ? 'pcm_f32le' : 'pcm_s16le',
    '-xerror',
    '-threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-f',
    'wav',
    outputPath,
  ]);

export const stitchTimedWavSegments = async ({
  segments,
  outputTag,
  outputDir,
  tempDir,
  probeAudioDuration,
}: TimedWavStitchOptions): Promise<string | null> => {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const validSegments = segments
    .filter(
      (value): value is TimedWavSegment =>
        !!value &&
        typeof value === 'object' &&
        typeof value.path === 'string' &&
        value.path.length > 0 &&
        fs.existsSync(value.path) &&
        typeof value.startSec === 'number' &&
        Number.isFinite(value.startSec) &&
        value.startSec >= 0 &&
        typeof value.endSec === 'number' &&
        Number.isFinite(value.endSec) &&
        value.endSec > value.startSec,
    )
    .sort((left, right) => left.startSec - right.startSec);
  // Publishing only the readable subset would turn missing speech into silence.
  if (validSegments.length !== segments.length) return null;

  const tag =
    (typeof outputTag === 'string' ? outputTag : 'stitched')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24) || 'stitched';
  const outputPath = path.join(
    outputDir,
    `${tag}_${Date.now()}_${randomUUID()}.wav`,
  );
  let workDir: string | undefined;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    workDir = fs.mkdtempSync(path.join(tempDir, 'pluto-audio-stitch-'));

    // The concat demuxer assumes one audio format. Decode every chunk using its
    // own WAV header before concatenating, including route/sample-rate changes.
    // One conversion at a time bounds open inputs and decoder memory.
    const normalizedPaths: string[] = [];
    const durations: number[] = [];
    for (let index = 0; index < validSegments.length; index += 1) {
      const normalizedPath = path.join(workDir, `chunk-${index}.wav`);
      await saveWav(['-i', validSegments[index].path], normalizedPath, true);
      normalizedPaths.push(normalizedPath);
      const duration = await probeAudioDuration(normalizedPath);
      if (duration === null || !Number.isFinite(duration) || duration <= 0)
        throw new Error(
          `Cannot determine decoded chunk duration at index ${index}`,
        );
      durations.push(duration);
    }

    const plan = planTimedWavStitch(validSegments, durations[0]);
    // Journal intervals include route/startup waits without PCM. Anchor each
    // contiguous chunk independently so missing frames cannot accumulate drift.
    // Keep overflow samples as overlap instead of trimming speech at boundaries.
    const audioStarts = validSegments.map((segment, index) =>
      plan.mode === 'sequential'
        ? Math.max(segment.startSec, segment.endSec - durations[index])
        : segment.startSec,
    );
    const canConcat =
      plan.mode === 'sequential' &&
      audioStarts.every(
        (start, index) =>
          index === 0 ||
          Math.abs(start - audioStarts[index - 1] - durations[index - 1]) <
            1 / 16000,
      );
    if (canConcat && plan.mode === 'sequential') {
      const concatPath = path.join(workDir, 'chunks.ffconcat');
      // Generated relative filenames also work when the temp directory contains
      // apostrophes, backslashes, or other concat syntax characters.
      fs.writeFileSync(
        concatPath,
        [
          'ffconcat version 1.0',
          ...normalizedPaths.map(
            (inputPath) => `file '${path.basename(inputPath)}'`,
          ),
          '',
        ].join('\n'),
      );
      await saveWav(
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatPath,
          '-af',
          [
            ...(plan.initialDelayMs > 0
              ? [`adelay=${plan.initialDelayMs}:all=1`]
              : []),
            'apad',
            `atrim=0:${plan.targetDurationSeconds}`,
          ].join(','),
        ],
        outputPath,
      );
    } else {
      // Sparse intervals retain absolute starts and additive overlap. Reduce
      // bounded groups instead of opening every recording chunk simultaneously.
      // Float intermediates prevent clipping before the final mix is complete.
      let inputs = normalizedPaths.map((inputPath, index) => ({
        path: inputPath,
        delayMs: Math.max(0, Math.round(audioStarts[index] * 1000)),
      }));
      let level = 0;
      while (true) {
        const next: typeof inputs = [];
        for (let offset = 0; offset < inputs.length; offset += MIX_BATCH_SIZE) {
          const batch = inputs.slice(offset, offset + MIX_BATCH_SIZE);
          const isFinal = inputs.length <= MIX_BATCH_SIZE;
          // Keep intermediate files local to their earliest input; leading
          // silence is applied once when this group joins the next level.
          const groupDelayMs = isFinal
            ? 0
            : Math.min(...batch.map((input) => input.delayMs));
          const mixedPath = isFinal
            ? outputPath
            : path.join(workDir, `mix-${level}-${offset}.wav`);
          const commandInputs = batch.flatMap((input) => ['-i', input.path]);
          const filters = [
            ...batch.map(
              (input, index) =>
                `[${index}:a]adelay=${input.delayMs - groupDelayMs}:all=1[a${index}]`,
            ),
            `${batch.map((_, index) => `[a${index}]`).join('')}amix=inputs=${batch.length}:duration=longest:normalize=0`,
          ];
          if (isFinal && plan.mode === 'sequential')
            filters[filters.length - 1] +=
              `,apad,atrim=0:${plan.targetDurationSeconds}`;
          await saveWav(
            [...commandInputs, '-filter_complex', filters.join(';')],
            mixedPath,
            !isFinal,
          );
          if (isFinal) break;
          next.push({ path: mixedPath, delayMs: groupDelayMs });
        }
        if (inputs.length <= MIX_BATCH_SIZE) break;
        // Each reduced group now owns its audio; discard the previous level.
        for (const input of inputs) fs.unlinkSync(input.path);
        inputs = next;
        level += 1;
      }
    }
    console.log(
      `[Pluto] Reconstructed WAV from ${validSegments.length} timed segments: ${outputPath}`,
    );
    return outputPath;
  } catch (error) {
    console.warn(
      '[Pluto] Timed WAV reconstruction failed:',
      error instanceof Error ? error.message : error,
    );
    fs.rmSync(outputPath, { force: true });
    return null;
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
};
