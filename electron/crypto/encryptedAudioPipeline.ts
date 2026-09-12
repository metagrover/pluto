import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import {
  ENCRYPTED_AUDIO_SAMPLE_RATE,
  type EncryptedAudioContext,
  encodeCanonicalPcm16Wav,
  openEncryptedAudioReader,
  writeEncryptedAudioBundle,
} from './encryptedAudioBundle.ts';

const MAX_REPAIR_ENVELOPE_BYTES = 64 * 1024 * 1024;
const MAX_NORMALIZED_REPAIR_BYTES = 8 * 1024 * 1024;

type SegmentDescriptor = {
  filePath: string;
  checksumSha256: string;
  sequence: number;
  startSec: number;
  endSec: number;
  durationSeconds: number;
};

const abortIfRequested = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw new DOMException('Operation aborted', 'AbortError');
};

const readBounded = async (filePath: string, maximumBytes: number) => {
  const file = await fs.promises.stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) {
    throw new Error('encrypted_audio_size_invalid');
  }
  return await fs.promises.readFile(filePath);
};

const runFfmpeg = async (
  input: Buffer,
  maximumOutputBytes: number,
  signal?: AbortSignal,
) => {
  abortIfRequested(signal);
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
      String(ENCRYPTED_AUDIO_SAMPLE_RATE),
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
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill('SIGKILL');
      reject(error);
    };
    const onAbort = () =>
      fail(new DOMException('Operation aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
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
      cleanup();
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

const openArtifact = async (
  filePath: string,
  context: EncryptedAudioContext,
  expected: { artifactKind?: string; source?: string; sequence?: number },
  maximumBytes: number,
) => {
  const envelope = await readBounded(filePath, maximumBytes);
  return EncryptedArtifactStore.open(envelope, context.meetingKey, {
    meetingId: context.meetingId,
    generation: context.generation,
    keyId: context.keyId,
    ...expected,
  }).plaintext;
};

const loadNormalizedRepair = async (
  descriptor: SegmentDescriptor,
  source: CaptureJournalSource,
  context: EncryptedAudioContext,
  signal?: AbortSignal,
) => {
  abortIfRequested(signal);
  const plaintext = await openArtifact(
    descriptor.filePath,
    context,
    {
      artifactKind: 'repair',
      source,
      sequence: descriptor.sequence,
    },
    MAX_REPAIR_ENVELOPE_BYTES,
  );
  if (
    createHash('sha256').update(plaintext).digest('hex') !==
    descriptor.checksumSha256
  ) {
    throw new Error(`sealed_capture_${source}_checksum_mismatch`);
  }
  const bytes = await runFfmpeg(plaintext, MAX_NORMALIZED_REPAIR_BYTES, signal);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
};

const probeWaveDuration = (wav: Buffer) => {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('encrypted_audio_repair_wav_invalid');
  }
  let byteRate = 0;
  let dataBytes = -1;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkBytes = wav.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    const contentEnd = contentStart + chunkBytes;
    if (contentEnd > wav.length) {
      throw new Error('encrypted_audio_repair_wav_invalid');
    }
    if (chunkId === 'fmt ' && chunkBytes >= 16) {
      byteRate = wav.readUInt32LE(contentStart + 8);
    } else if (chunkId === 'data') {
      dataBytes = chunkBytes;
    }
    offset = contentEnd + (chunkBytes % 2);
  }
  if (byteRate <= 0 || dataBytes < 0) {
    throw new Error('encrypted_audio_repair_wav_invalid');
  }
  return dataBytes / byteRate;
};

const probeAuthenticatedRepairDuration = async (
  descriptor: Omit<SegmentDescriptor, 'durationSeconds'>,
  source: CaptureJournalSource,
  context: EncryptedAudioContext,
) => {
  const plaintext = await openArtifact(
    descriptor.filePath,
    context,
    {
      artifactKind: 'repair',
      source,
      sequence: descriptor.sequence,
    },
    MAX_REPAIR_ENVELOPE_BYTES,
  );
  if (
    createHash('sha256').update(plaintext).digest('hex') !==
    descriptor.checksumSha256
  ) {
    throw new Error(`sealed_capture_${source}_checksum_mismatch`);
  }
  return probeWaveDuration(plaintext);
};

export const materializeEncryptedJournalSource = async (args: {
  rootDir: string;
  manifest: CaptureJournalManifestV4;
  source: CaptureJournalSource;
  meetingKey: Buffer;
  signal?: AbortSignal;
}): Promise<string | null> => {
  const context: EncryptedAudioContext = {
    meetingId: args.manifest.meetingId,
    generation: args.manifest.generation,
    keyId: args.manifest.keyId,
    meetingKey: args.meetingKey,
  };
  const descriptors: SegmentDescriptor[] = [];
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
    const descriptor = {
      filePath: path.join(args.rootDir, disposition.repairRelativePath),
      checksumSha256: disposition.repairChecksumSha256,
      sequence: interval.sequence,
      startSec: interval.chunkStartSec,
      endSec: interval.chunkEndSec,
    };
    descriptors.push({
      ...descriptor,
      durationSeconds: await probeAuthenticatedRepairDuration(
        descriptor,
        args.source,
        context,
      ),
    });
  }
  if (descriptors.length === 0) return null;

  const firstSamples = await loadNormalizedRepair(
    descriptors[0],
    args.source,
    context,
    args.signal,
  );
  const plan = planTimedWavStitch(
    descriptors.map((segment) => ({
      path: segment.filePath,
      startSec: segment.startSec,
      endSec: segment.endSec,
    })),
    firstSamples.length / ENCRYPTED_AUDIO_SAMPLE_RATE,
  );
  const starts = descriptors.map((segment) => {
    if (plan.mode !== 'sequential') return segment.startSec;
    return Math.max(segment.startSec, segment.endSec - segment.durationSeconds);
  });
  const contentEndSeconds =
    plan.mode === 'sequential'
      ? plan.targetDurationSeconds
      : Math.max(
          ...descriptors.map(
            (segment, index) => starts[index] + segment.durationSeconds,
          ),
        );
  const totalFrames = Math.ceil(
    Math.max(contentEndSeconds, timelineEndSeconds) *
      ENCRYPTED_AUDIO_SAMPLE_RATE,
  );

  let firstPending = true;
  return await writeEncryptedAudioBundle({
    rootDir: args.rootDir,
    totalFrames,
    source: args.source,
    context,
    signal: args.signal,
    produceWindow: async (windowStart, frameCount) => {
      abortIfRequested(args.signal);
      const output = new Float32Array(frameCount);
      const windowEnd = windowStart + frameCount;
      for (let index = 0; index < descriptors.length; index += 1) {
        const segmentStart = Math.max(
          0,
          Math.round(starts[index] * ENCRYPTED_AUDIO_SAMPLE_RATE),
        );
        const segmentEnd =
          segmentStart +
          Math.round(
            descriptors[index].durationSeconds * ENCRYPTED_AUDIO_SAMPLE_RATE,
          );
        if (segmentEnd <= windowStart || segmentStart >= windowEnd) continue;
        const samples =
          index === 0 && firstPending
            ? firstSamples
            : await loadNormalizedRepair(
                descriptors[index],
                args.source,
                context,
                args.signal,
              );
        if (index === 0) firstPending = false;
        const overlapStart = Math.max(windowStart, segmentStart);
        const overlapEnd = Math.min(windowEnd, segmentStart + samples.length);
        for (let frame = overlapStart; frame < overlapEnd; frame += 1) {
          output[frame - windowStart] += samples[frame - segmentStart];
        }
      }
      return output;
    },
  });
};

export const repairEncryptedJournalRawChunk = async (args: {
  filePath: string;
  manifest: CaptureJournalManifestV4;
  source: CaptureJournalSource;
  sequence: number;
  expectedPlaintextSha256: string;
  meetingKey: Buffer;
  signal?: AbortSignal;
}): Promise<Buffer> => {
  const context: EncryptedAudioContext = {
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
  const samples = await runFfmpeg(
    plaintext,
    MAX_NORMALIZED_REPAIR_BYTES,
    args.signal,
  );
  return encodeCanonicalPcm16Wav(
    new Float32Array(samples.buffer, samples.byteOffset, samples.length / 4),
  );
};

export const mixEncryptedAudioArtifacts = async (args: {
  rootDir: string;
  inputPaths: [string, string];
  context: EncryptedAudioContext;
  signal?: AbortSignal;
}): Promise<string> => {
  const [left, right] = await Promise.all([
    openEncryptedAudioReader({
      filePath: args.inputPaths[0],
      context: args.context,
      source: 'mic',
      signal: args.signal,
    }),
    openEncryptedAudioReader({
      filePath: args.inputPaths[1],
      context: args.context,
      source: 'system',
      signal: args.signal,
    }),
  ]);
  return await writeEncryptedAudioBundle({
    rootDir: args.rootDir,
    totalFrames: Math.max(left.totalFrames, right.totalFrames),
    source: 'mixed',
    context: args.context,
    signal: args.signal,
    produceWindow: async (startFrame, frameCount) => {
      abortIfRequested(args.signal);
      const [leftSamples, rightSamples] = await Promise.all([
        left.readWindow(startFrame, frameCount),
        right.readWindow(startFrame, frameCount),
      ]);
      for (let index = 0; index < frameCount; index += 1) {
        leftSamples[index] += rightSamples[index];
      }
      return leftSamples;
    },
  });
};

export const probeEncryptedAudioDuration = async (
  filePath: string,
  context: EncryptedAudioContext,
) => {
  const reader = await openEncryptedAudioReader({ filePath, context });
  return reader.totalFrames / ENCRYPTED_AUDIO_SAMPLE_RATE;
};

export const sliceEncryptedAudio = async (args: {
  filePath: string;
  context: EncryptedAudioContext;
  startSec: number;
  durationSec: number;
  signal?: AbortSignal;
}) => {
  const reader = await openEncryptedAudioReader({
    filePath: args.filePath,
    context: args.context,
    signal: args.signal,
  });
  abortIfRequested(args.signal);
  const start = Math.max(
    0,
    Math.floor(args.startSec * ENCRYPTED_AUDIO_SAMPLE_RATE),
  );
  const end = Math.min(
    reader.totalFrames,
    Math.ceil((args.startSec + args.durationSec) * ENCRYPTED_AUDIO_SAMPLE_RATE),
  );
  return encodeCanonicalPcm16Wav(
    await reader.readWindow(start, Math.max(0, end - start)),
  );
};
