import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

import type {
  CaptureJournalManifestV4,
  CaptureJournalSource,
} from '../captureJournal';
import { resolveUnpackedExecutablePath } from '../packagedExecutablePath.ts';
import { planTimedWavStitch } from '../timedWavStitchPlan.ts';
import { EncryptedArtifactStore } from './encryptedArtifactStore.ts';

const SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;
const MAX_REPAIR_ENVELOPE_BYTES = 64 * 1024 * 1024;
export const MAX_ENCRYPTED_AUDIO_BYTES = 512 * 1024 * 1024;

type EncryptionContext = {
  meetingId: string;
  generation: string;
  keyId: string;
  meetingKey: Buffer;
};

type NormalizedSegment = {
  samples: Buffer;
  startSec: number;
  endSec: number;
};

const readBounded = async (filePath: string, maximumBytes: number) => {
  const file = await fs.promises.stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) {
    throw new Error('encrypted_audio_size_invalid');
  }
  return await fs.promises.readFile(filePath);
};

const runFfmpeg = async (input: Buffer, maximumOutputBytes: number) => {
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) throw new Error('ffmpeg_unavailable');
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(resolveUnpackedExecutablePath(ffmpegPath), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      '-c:a',
      'pcm_f32le',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderr = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(error);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        fail(new Error('encrypted_audio_decoded_size_exceeded'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString('utf8');
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`encrypted_audio_decode_failed:${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks, outputBytes));
    });
    child.stdin.on('error', fail);
    child.stdin.end(input);
  });
};

const encodePcm16Wav = (samples: Float32Array): Buffer => {
  const dataBytes = samples.length * 2;
  if (dataBytes + WAV_HEADER_BYTES > MAX_ENCRYPTED_AUDIO_BYTES) {
    throw new Error('encrypted_audio_output_size_exceeded');
  }
  const wav = Buffer.allocUnsafe(WAV_HEADER_BYTES + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    wav.writeInt16LE(
      sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767),
      WAV_HEADER_BYTES + index * 2,
    );
  }
  return wav;
};

const parseCanonicalPcm16Wav = (wav: Buffer): Int16Array => {
  if (
    wav.length < WAV_HEADER_BYTES ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== SAMPLE_RATE ||
    wav.readUInt16LE(34) !== 16 ||
    wav.toString('ascii', 36, 40) !== 'data' ||
    wav.readUInt32LE(40) !== wav.length - WAV_HEADER_BYTES
  ) {
    throw new Error('encrypted_audio_wav_invalid');
  }
  return new Int16Array(
    wav.buffer,
    wav.byteOffset + WAV_HEADER_BYTES,
    (wav.length - WAV_HEADER_BYTES) / 2,
  );
};

const openArtifact = async (
  filePath: string,
  context: EncryptionContext,
  expected: { artifactKind?: string; source?: string; sequence?: number },
  maximumBytes = MAX_ENCRYPTED_AUDIO_BYTES,
) => {
  const envelope = await readBounded(filePath, maximumBytes);
  return EncryptedArtifactStore.open(envelope, context.meetingKey, {
    meetingId: context.meetingId,
    generation: context.generation,
    keyId: context.keyId,
    ...expected,
  }).plaintext;
};

const writeArtifact = async (
  rootDir: string,
  plaintext: Buffer,
  context: EncryptionContext,
  artifactKind: 'mic' | 'system' | 'mixed',
) => {
  const outputPath = path.join(rootDir, `${randomUUID()}.enc`);
  await EncryptedArtifactStore.writeEncryptedFile(
    outputPath,
    plaintext,
    context.meetingKey,
    {
      meetingId: context.meetingId,
      generation: context.generation,
      keyId: context.keyId,
      artifactKind,
      source: artifactKind,
      sequence: 0,
    },
  );
  return outputPath;
};

const stitchNormalizedSegments = (
  segments: NormalizedSegment[],
  timelineEndSeconds: number,
) => {
  if (segments.length === 0) return null;
  const durations = segments.map(
    (segment) => segment.samples.length / 4 / SAMPLE_RATE,
  );
  const plan = planTimedWavStitch(
    segments.map((segment) => ({
      path: 'authenticated-memory',
      startSec: segment.startSec,
      endSec: segment.endSec,
    })),
    durations[0],
  );
  const starts = segments.map((segment, index) =>
    plan.mode === 'sequential'
      ? Math.max(segment.startSec, segment.endSec - durations[index])
      : segment.startSec,
  );
  const contentEndSeconds =
    plan.mode === 'sequential'
      ? plan.targetDurationSeconds
      : Math.max(
          ...segments.map(
            (_segment, index) => starts[index] + durations[index],
          ),
        );
  const targetFrames = Math.ceil(
    Math.max(contentEndSeconds, timelineEndSeconds) * SAMPLE_RATE,
  );
  if (
    targetFrames <= 0 ||
    targetFrames * Float32Array.BYTES_PER_ELEMENT > MAX_ENCRYPTED_AUDIO_BYTES
  ) {
    throw new Error('encrypted_audio_timeline_size_exceeded');
  }
  const mixed = new Float32Array(targetFrames);
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const input = new Float32Array(
      segments[segmentIndex].samples.buffer,
      segments[segmentIndex].samples.byteOffset,
      segments[segmentIndex].samples.length / 4,
    );
    const startFrame = Math.max(
      0,
      Math.round(starts[segmentIndex] * SAMPLE_RATE),
    );
    const frames = Math.min(input.length, mixed.length - startFrame);
    for (let frame = 0; frame < frames; frame += 1) {
      mixed[startFrame + frame] += input[frame];
    }
  }
  return encodePcm16Wav(mixed);
};

export const materializeEncryptedJournalSource = async (args: {
  rootDir: string;
  manifest: CaptureJournalManifestV4;
  source: CaptureJournalSource;
  meetingKey: Buffer;
}): Promise<string | null> => {
  const context: EncryptionContext = {
    meetingId: args.manifest.meetingId,
    generation: args.manifest.generation,
    keyId: args.manifest.keyId,
    meetingKey: args.meetingKey,
  };
  const segments: NormalizedSegment[] = [];
  let timelineEndSeconds = 0;
  for (const interval of [...args.manifest.intervals].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const disposition = interval.sources[args.source];
    timelineEndSeconds = Math.max(timelineEndSeconds, interval.chunkEndSec);
    if (
      disposition.disposition === 'verified_silence' ||
      disposition.disposition === 'source_unavailable'
    ) {
      continue;
    }
    if (disposition.disposition !== 'captured') {
      throw new Error(`sealed_capture_${args.source}_artifact_gap`);
    }
    const plaintext = await openArtifact(
      path.join(args.rootDir, disposition.repairRelativePath),
      context,
      {
        artifactKind: 'repair',
        source: args.source,
        sequence: interval.sequence,
      },
      MAX_REPAIR_ENVELOPE_BYTES,
    );
    const checksum = createHash('sha256').update(plaintext).digest('hex');
    if (checksum !== disposition.repairChecksumSha256) {
      throw new Error(`sealed_capture_${args.source}_checksum_mismatch`);
    }
    segments.push({
      samples: await runFfmpeg(plaintext, MAX_REPAIR_ENVELOPE_BYTES),
      startSec: interval.chunkStartSec,
      endSec: interval.chunkEndSec,
    });
  }
  const wav = stitchNormalizedSegments(segments, timelineEndSeconds);
  if (!wav) return null;
  return await writeArtifact(args.rootDir, wav, context, args.source);
};

export const repairEncryptedJournalRawChunk = async (args: {
  filePath: string;
  manifest: CaptureJournalManifestV4;
  source: CaptureJournalSource;
  sequence: number;
  expectedPlaintextSha256: string;
  meetingKey: Buffer;
}): Promise<Buffer> => {
  const context: EncryptionContext = {
    meetingId: args.manifest.meetingId,
    generation: args.manifest.generation,
    keyId: args.manifest.keyId,
    meetingKey: args.meetingKey,
  };
  const plaintext = await openArtifact(
    args.filePath,
    context,
    {
      artifactKind: 'raw',
      source: args.source,
      sequence: args.sequence,
    },
    MAX_REPAIR_ENVELOPE_BYTES,
  );
  if (
    createHash('sha256').update(plaintext).digest('hex') !==
    args.expectedPlaintextSha256
  ) {
    throw new Error('encrypted_audio_raw_checksum_mismatch');
  }
  const samples = await runFfmpeg(plaintext, MAX_REPAIR_ENVELOPE_BYTES);
  return encodePcm16Wav(
    new Float32Array(samples.buffer, samples.byteOffset, samples.length / 4),
  );
};

export const mixEncryptedAudioArtifacts = async (args: {
  rootDir: string;
  inputPaths: [string, string];
  context: EncryptionContext;
}): Promise<string> => {
  const [leftWav, rightWav] = await Promise.all([
    openArtifact(args.inputPaths[0], args.context, {
      artifactKind: 'mic',
      source: 'mic',
    }),
    openArtifact(args.inputPaths[1], args.context, {
      artifactKind: 'system',
      source: 'system',
    }),
  ]);
  const left = parseCanonicalPcm16Wav(leftWav);
  const right = parseCanonicalPcm16Wav(rightWav);
  const frameCount = Math.max(left.length, right.length);
  const mixed = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    mixed[index] = (left[index] ?? 0) / 32_768 + (right[index] ?? 0) / 32_768;
  }
  return await writeArtifact(
    args.rootDir,
    encodePcm16Wav(mixed),
    args.context,
    'mixed',
  );
};

export const probeEncryptedAudioDuration = async (
  filePath: string,
  context: EncryptionContext,
) => {
  const wav = await openArtifact(filePath, context, {});
  return parseCanonicalPcm16Wav(wav).length / SAMPLE_RATE;
};

export const sliceEncryptedAudio = async (args: {
  filePath: string;
  context: EncryptionContext;
  startSec: number;
  durationSec: number;
}) => {
  const wav = await openArtifact(args.filePath, args.context, {});
  const samples = parseCanonicalPcm16Wav(wav);
  const start = Math.max(0, Math.floor(args.startSec * SAMPLE_RATE));
  const end = Math.min(
    samples.length,
    Math.ceil((args.startSec + args.durationSec) * SAMPLE_RATE),
  );
  const sliced = new Float32Array(Math.max(0, end - start));
  for (let index = start; index < end; index += 1) {
    sliced[index - start] = samples[index] / 32_768;
  }
  return encodePcm16Wav(sliced);
};
