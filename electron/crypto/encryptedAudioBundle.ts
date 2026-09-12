import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { EncryptedArtifactStore } from './encryptedArtifactStore.ts';

export const ENCRYPTED_AUDIO_SAMPLE_RATE = 16_000;
export const ENCRYPTED_AUDIO_SEGMENT_SECONDS = 60;
export const ENCRYPTED_AUDIO_SEGMENT_FRAMES =
  ENCRYPTED_AUDIO_SAMPLE_RATE * ENCRYPTED_AUDIO_SEGMENT_SECONDS;
export const MAX_AUDIO_INDEX_BYTES = 1024 * 1024;
export const MAX_LEGACY_AUDIO_BYTES = 512 * 1024 * 1024;
const WAV_HEADER_BYTES = 44;
const MAX_SEGMENT_WAV_BYTES =
  WAV_HEADER_BYTES + ENCRYPTED_AUDIO_SEGMENT_FRAMES * 2;
const MAX_SEGMENT_ENVELOPE_BYTES = MAX_SEGMENT_WAV_BYTES + 1024;

export type EncryptedAudioContext = {
  meetingId: string;
  generation: string;
  keyId: string;
  meetingKey: Buffer;
};

type EncryptedAudioSource = 'mic' | 'system' | 'mixed';

type AudioIndexSegment = {
  relativePath: string;
  sequence: number;
  startFrame: number;
  frameCount: number;
  plaintextSha256: string;
};

type AudioIndex = {
  schemaVersion: 1;
  sampleRate: typeof ENCRYPTED_AUDIO_SAMPLE_RATE;
  totalFrames: number;
  segments: AudioIndexSegment[];
};

export type EncryptedAudioReader = {
  totalFrames: number;
  readWindow: (startFrame: number, frameCount: number) => Promise<Float32Array>;
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

export const encodeCanonicalPcm16Wav = (
  samples: Float32Array | Int16Array,
): Buffer => {
  const dataBytes = samples.length * 2;
  if (dataBytes + WAV_HEADER_BYTES > MAX_SEGMENT_WAV_BYTES) {
    throw new Error('encrypted_audio_segment_size_exceeded');
  }
  const wav = Buffer.allocUnsafe(WAV_HEADER_BYTES + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(ENCRYPTED_AUDIO_SAMPLE_RATE, 24);
  wav.writeUInt32LE(ENCRYPTED_AUDIO_SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    const pcm =
      samples instanceof Int16Array
        ? value
        : value < 0
          ? Math.round(Math.max(-1, value) * 32_768)
          : Math.round(Math.min(1, value) * 32_767);
    wav.writeInt16LE(Math.max(-32_768, Math.min(32_767, pcm)), 44 + index * 2);
  }
  return wav;
};

export const parseCanonicalPcm16Wav = (wav: Buffer): Int16Array => {
  if (
    wav.length < WAV_HEADER_BYTES ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== ENCRYPTED_AUDIO_SAMPLE_RATE ||
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

const validateIndex = (value: unknown): AudioIndex => {
  const index = value as Partial<AudioIndex>;
  if (
    index?.schemaVersion !== 1 ||
    index.sampleRate !== ENCRYPTED_AUDIO_SAMPLE_RATE ||
    !Number.isSafeInteger(index.totalFrames) ||
    Number(index.totalFrames) < 0 ||
    !Array.isArray(index.segments)
  ) {
    throw new Error('encrypted_audio_index_invalid');
  }
  let expectedStart = 0;
  for (let sequence = 0; sequence < index.segments.length; sequence += 1) {
    const segment = index.segments[sequence];
    if (
      segment?.sequence !== sequence ||
      segment.startFrame !== expectedStart ||
      !Number.isSafeInteger(segment.frameCount) ||
      segment.frameCount <= 0 ||
      segment.frameCount > ENCRYPTED_AUDIO_SEGMENT_FRAMES ||
      typeof segment.relativePath !== 'string' ||
      path.basename(segment.relativePath) !== segment.relativePath ||
      !/^[a-f0-9-]+\.enc$/.test(segment.relativePath) ||
      !/^[a-f0-9]{64}$/.test(segment.plaintextSha256)
    ) {
      throw new Error('encrypted_audio_index_segment_invalid');
    }
    expectedStart += segment.frameCount;
  }
  if (expectedStart !== index.totalFrames) {
    throw new Error('encrypted_audio_index_duration_mismatch');
  }
  return index as AudioIndex;
};

export const writeEncryptedAudioBundle = async (args: {
  rootDir: string;
  totalFrames: number;
  source: EncryptedAudioSource;
  context: EncryptedAudioContext;
  produceWindow: (
    startFrame: number,
    frameCount: number,
  ) => Promise<Float32Array>;
  signal?: AbortSignal;
}): Promise<string> => {
  if (!Number.isSafeInteger(args.totalFrames) || args.totalFrames <= 0) {
    throw new Error('encrypted_audio_total_frames_invalid');
  }
  const createdPaths: string[] = [];
  const segments: AudioIndexSegment[] = [];
  try {
    for (
      let startFrame = 0, sequence = 0;
      startFrame < args.totalFrames;
      startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES, sequence += 1
    ) {
      abortIfRequested(args.signal);
      const frameCount = Math.min(
        ENCRYPTED_AUDIO_SEGMENT_FRAMES,
        args.totalFrames - startFrame,
      );
      const samples = await args.produceWindow(startFrame, frameCount);
      abortIfRequested(args.signal);
      if (samples.length !== frameCount) {
        throw new Error('encrypted_audio_window_length_mismatch');
      }
      const wav = encodeCanonicalPcm16Wav(samples);
      const relativePath = `${randomUUID()}.enc`;
      const segmentPath = path.join(args.rootDir, relativePath);
      createdPaths.push(segmentPath);
      const written = await EncryptedArtifactStore.writeEncryptedFile(
        segmentPath,
        wav,
        args.context.meetingKey,
        {
          meetingId: args.context.meetingId,
          generation: args.context.generation,
          keyId: args.context.keyId,
          artifactKind: 'audio_segment',
          source: args.source,
          sequence,
        },
        { directoryReady: true },
      );
      segments.push({
        relativePath,
        sequence,
        startFrame,
        frameCount,
        plaintextSha256: written.plaintextSha256,
      });
    }
    abortIfRequested(args.signal);
    const index: AudioIndex = {
      schemaVersion: 1,
      sampleRate: ENCRYPTED_AUDIO_SAMPLE_RATE,
      totalFrames: args.totalFrames,
      segments,
    };
    const indexPath = path.join(args.rootDir, `${randomUUID()}.enc`);
    createdPaths.push(indexPath);
    await EncryptedArtifactStore.writeEncryptedFile(
      indexPath,
      Buffer.from(JSON.stringify(index), 'utf8'),
      args.context.meetingKey,
      {
        meetingId: args.context.meetingId,
        generation: args.context.generation,
        keyId: args.context.keyId,
        artifactKind: 'audio_index',
        source: args.source,
        sequence: 0,
      },
      { directoryReady: true },
    );
    return indexPath;
  } catch (error) {
    await Promise.all(
      createdPaths.map((filePath) =>
        fs.promises.unlink(filePath).catch(() => {}),
      ),
    );
    throw error;
  }
};

export const openEncryptedAudioReader = async (args: {
  filePath: string;
  context: EncryptedAudioContext;
  source?: EncryptedAudioSource;
  signal?: AbortSignal;
}): Promise<EncryptedAudioReader> => {
  const validateWindow = (startFrame: number, frameCount: number) => {
    if (
      !Number.isSafeInteger(startFrame) ||
      !Number.isSafeInteger(frameCount) ||
      startFrame < 0 ||
      frameCount < 0
    ) {
      throw new Error('encrypted_audio_window_invalid');
    }
  };
  abortIfRequested(args.signal);
  const initial = await readBounded(args.filePath, MAX_LEGACY_AUDIO_BYTES);
  abortIfRequested(args.signal);
  const opened = EncryptedArtifactStore.open(initial, args.context.meetingKey, {
    meetingId: args.context.meetingId,
    generation: args.context.generation,
    keyId: args.context.keyId,
    ...(args.source ? { source: args.source } : {}),
  });
  if (opened.header.artifactKind !== 'audio_index') {
    if (!['mic', 'system', 'mixed'].includes(opened.header.artifactKind)) {
      throw new Error('encrypted_audio_artifact_kind_invalid');
    }
    const samples = parseCanonicalPcm16Wav(opened.plaintext);
    return {
      totalFrames: samples.length,
      readWindow: async (startFrame, frameCount) => {
        abortIfRequested(args.signal);
        validateWindow(startFrame, frameCount);
        const start = Math.max(0, Math.min(samples.length, startFrame));
        const end = Math.max(
          start,
          Math.min(samples.length, start + frameCount),
        );
        const result = new Float32Array(frameCount);
        for (let index = start; index < end; index += 1) {
          result[index - startFrame] = samples[index] / 32_768;
        }
        return result;
      },
    };
  }

  if (opened.plaintext.length > MAX_AUDIO_INDEX_BYTES) {
    throw new Error('encrypted_audio_index_size_exceeded');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(opened.plaintext.toString('utf8'));
  } catch {
    throw new Error('encrypted_audio_index_invalid');
  }
  const index = validateIndex(parsed);
  const parent = path.dirname(args.filePath);
  return {
    totalFrames: index.totalFrames,
    readWindow: async (startFrame, frameCount) => {
      abortIfRequested(args.signal);
      validateWindow(startFrame, frameCount);
      const output = new Float32Array(frameCount);
      const requestedEnd = Math.min(index.totalFrames, startFrame + frameCount);
      for (const segment of index.segments) {
        abortIfRequested(args.signal);
        const segmentEnd = segment.startFrame + segment.frameCount;
        const overlapStart = Math.max(startFrame, segment.startFrame);
        const overlapEnd = Math.min(requestedEnd, segmentEnd);
        if (overlapEnd <= overlapStart) continue;
        const segmentPath = path.join(parent, segment.relativePath);
        const envelope = await readBounded(
          segmentPath,
          MAX_SEGMENT_ENVELOPE_BYTES,
        );
        const artifact = EncryptedArtifactStore.open(
          envelope,
          args.context.meetingKey,
          {
            meetingId: args.context.meetingId,
            generation: args.context.generation,
            keyId: args.context.keyId,
            artifactKind: 'audio_segment',
            source: opened.header.source,
            sequence: segment.sequence,
          },
        );
        abortIfRequested(args.signal);
        if (
          createHash('sha256').update(artifact.plaintext).digest('hex') !==
          segment.plaintextSha256
        ) {
          throw new Error('encrypted_audio_segment_checksum_mismatch');
        }
        const samples = parseCanonicalPcm16Wav(artifact.plaintext);
        if (samples.length !== segment.frameCount) {
          throw new Error('encrypted_audio_segment_frame_mismatch');
        }
        for (let frame = overlapStart; frame < overlapEnd; frame += 1) {
          output[frame - startFrame] =
            samples[frame - segment.startFrame] / 32_768;
        }
      }
      return output;
    },
  };
};
