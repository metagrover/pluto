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
const MAX_AUDIO_INDEX_ENVELOPE_BYTES = MAX_AUDIO_INDEX_BYTES + 65_571;
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

export const listEncryptedAudioBundleFiles = async (args: {
  filePath: string;
  context: EncryptedAudioContext;
  source?: EncryptedAudioSource;
}): Promise<string[]> => {
  const file = await fs.promises.stat(args.filePath);
  if (!file.isFile() || file.size <= 0) {
    throw new Error('encrypted_audio_size_invalid');
  }
  // Segmented indexes have a strict 1 MiB plaintext cap plus the maximum
  // envelope overhead. Larger artifacts are legacy single-file recordings,
  // so retention never buffers a process-sized recording just to list it.
  if (file.size > MAX_AUDIO_INDEX_ENVELOPE_BYTES) return [args.filePath];
  const initial = await readBounded(
    args.filePath,
    MAX_AUDIO_INDEX_ENVELOPE_BYTES,
  );
  const opened = EncryptedArtifactStore.open(initial, args.context.meetingKey, {
    meetingId: args.context.meetingId,
    generation: args.context.generation,
    keyId: args.context.keyId,
    ...(args.source ? { source: args.source } : {}),
  });
  if (opened.header.artifactKind !== 'audio_index') return [args.filePath];
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
  return [
    args.filePath,
    ...index.segments.map((segment) => path.join(parent, segment.relativePath)),
  ];
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

export const migrateCanonicalPlaintextWavToEncryptedBundle = async (args: {
  filePath: string;
  rootDir: string;
  source: EncryptedAudioSource;
  context: EncryptedAudioContext;
  signal?: AbortSignal;
}): Promise<string> => {
  const handle = await fs.promises.open(args.filePath, 'r');
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.size <= 44 || (file.size - 44) % 2 !== 0) {
      throw new Error('historical_audio_wav_invalid');
    }
    const header = Buffer.alloc(44);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (
      headerRead.bytesRead !== header.length ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.readUInt32LE(4) !== file.size - 8 ||
      header.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      header.readUInt32LE(16) !== 16 ||
      header.readUInt16LE(20) !== 1 ||
      header.readUInt16LE(22) !== 1 ||
      header.readUInt32LE(24) !== ENCRYPTED_AUDIO_SAMPLE_RATE ||
      header.readUInt32LE(28) !== ENCRYPTED_AUDIO_SAMPLE_RATE * 2 ||
      header.readUInt16LE(32) !== 2 ||
      header.readUInt16LE(34) !== 16 ||
      header.toString('ascii', 36, 40) !== 'data' ||
      header.readUInt32LE(40) !== file.size - 44
    ) {
      throw new Error('historical_audio_wav_not_canonical');
    }
    const totalFrames = (file.size - 44) / 2;
    const readPlaintextWindow = async (
      startFrame: number,
      frameCount: number,
    ) => {
      abortIfRequested(args.signal);
      const bytes = Buffer.allocUnsafe(frameCount * 2);
      const result = await handle.read(
        bytes,
        0,
        bytes.length,
        44 + startFrame * 2,
      );
      if (result.bytesRead !== bytes.length) {
        throw new Error('historical_audio_wav_truncated');
      }
      return bytes;
    };
    const encryptedPath = await writeEncryptedAudioBundle({
      rootDir: args.rootDir,
      totalFrames,
      source: args.source,
      context: args.context,
      signal: args.signal,
      produceWindow: async (startFrame, frameCount) => {
        const bytes = await readPlaintextWindow(startFrame, frameCount);
        const samples = new Float32Array(frameCount);
        for (let index = 0; index < frameCount; index += 1) {
          const sample = bytes.readInt16LE(index * 2);
          samples[index] = sample < 0 ? sample / 32_768 : sample / 32_767;
        }
        return samples;
      },
    });
    try {
      const reader = await openEncryptedAudioReader({
        filePath: encryptedPath,
        context: args.context,
        source: args.source,
        signal: args.signal,
      });
      if (reader.totalFrames !== totalFrames) {
        throw new Error('historical_audio_verification_failed');
      }
      for (
        let startFrame = 0;
        startFrame < totalFrames;
        startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES
      ) {
        const frameCount = Math.min(
          ENCRYPTED_AUDIO_SEGMENT_FRAMES,
          totalFrames - startFrame,
        );
        const [plain, opened] = await Promise.all([
          readPlaintextWindow(startFrame, frameCount),
          reader.readWindow(startFrame, frameCount),
        ]);
        for (let index = 0; index < frameCount; index += 1) {
          const expected = plain.readInt16LE(index * 2);
          const actual = Math.round(opened[index] * 32_768);
          if (actual !== expected) {
            throw new Error('historical_audio_verification_failed');
          }
        }
      }
      return encryptedPath;
    } catch (error) {
      for (const managedPath of await listEncryptedAudioBundleFiles({
        filePath: encryptedPath,
        context: args.context,
        source: args.source,
      }).catch(() => [encryptedPath])) {
        await fs.promises.unlink(managedPath).catch(() => {});
      }
      throw error;
    }
  } finally {
    await handle.close();
  }
};

export const verifyEncryptedBundleMatchesCanonicalPlaintextWav = async (args: {
  plaintextPath: string;
  encryptedPath: string;
  source: EncryptedAudioSource;
  context: EncryptedAudioContext;
  signal?: AbortSignal;
}): Promise<void> => {
  const handle = await fs.promises.open(args.plaintextPath, 'r');
  try {
    const file = await handle.stat();
    const header = Buffer.alloc(44);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (
      !file.isFile() ||
      file.size <= 44 ||
      (file.size - 44) % 2 !== 0 ||
      headerRead.bytesRead !== header.length ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.readUInt32LE(4) !== file.size - 8 ||
      header.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      header.readUInt16LE(20) !== 1 ||
      header.readUInt16LE(22) !== 1 ||
      header.readUInt32LE(24) !== ENCRYPTED_AUDIO_SAMPLE_RATE ||
      header.readUInt16LE(34) !== 16 ||
      header.toString('ascii', 36, 40) !== 'data' ||
      header.readUInt32LE(40) !== file.size - 44
    ) {
      throw new Error('historical_audio_wav_not_canonical');
    }
    const totalFrames = (file.size - 44) / 2;
    const reader = await openEncryptedAudioReader({
      filePath: args.encryptedPath,
      context: args.context,
      source: args.source,
      signal: args.signal,
    });
    if (reader.totalFrames !== totalFrames) {
      throw new Error('historical_audio_verification_failed');
    }
    for (
      let startFrame = 0;
      startFrame < totalFrames;
      startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES
    ) {
      abortIfRequested(args.signal);
      const frameCount = Math.min(
        ENCRYPTED_AUDIO_SEGMENT_FRAMES,
        totalFrames - startFrame,
      );
      const plain = Buffer.allocUnsafe(frameCount * 2);
      const [read, opened] = await Promise.all([
        handle.read(plain, 0, plain.length, 44 + startFrame * 2),
        reader.readWindow(startFrame, frameCount),
      ]);
      if (read.bytesRead !== plain.length) {
        throw new Error('historical_audio_wav_truncated');
      }
      for (let index = 0; index < frameCount; index += 1) {
        if (
          Math.round(opened[index] * 32_768) !== plain.readInt16LE(index * 2)
        ) {
          throw new Error('historical_audio_verification_failed');
        }
      }
    }
  } finally {
    await handle.close();
  }
};

export const verifyEncryptedAudioBundle = async (args: {
  encryptedPath: string;
  source: EncryptedAudioSource;
  context: EncryptedAudioContext;
  signal?: AbortSignal;
}): Promise<void> => {
  const reader = await openEncryptedAudioReader({
    filePath: args.encryptedPath,
    context: args.context,
    source: args.source,
    signal: args.signal,
  });
  for (
    let startFrame = 0;
    startFrame < reader.totalFrames;
    startFrame += ENCRYPTED_AUDIO_SEGMENT_FRAMES
  ) {
    abortIfRequested(args.signal);
    await reader.readWindow(
      startFrame,
      Math.min(ENCRYPTED_AUDIO_SEGMENT_FRAMES, reader.totalFrames - startFrame),
    );
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
