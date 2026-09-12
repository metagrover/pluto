import { parentPort, workerData } from 'node:worker_threads';
import type { AudioRequest } from './encryptedAudioPipeline';
import * as pipeline from './encryptedAudioPipelineImpl';

// Structured clone turns Buffers into Uint8Arrays. Encrypted files are read and
// authenticated here; only operation arguments and keys arrive from the app.
const request = workerData as AudioRequest;
const execute = async () => {
  switch (request.operation) {
    case 'materializeEncryptedJournalSource': {
      const [args] = request.args as Parameters<
        typeof pipeline.materializeEncryptedJournalSource
      >;
      return pipeline.materializeEncryptedJournalSource({
        ...args,
        meetingKey: Buffer.from(args.meetingKey),
      });
    }
    case 'repairEncryptedJournalRawChunk': {
      const [args] = request.args as Parameters<
        typeof pipeline.repairEncryptedJournalRawChunk
      >;
      return pipeline.repairEncryptedJournalRawChunk({
        ...args,
        meetingKey: Buffer.from(args.meetingKey),
      });
    }
    case 'probeEncryptedAudioDuration': {
      const [filePath, context] = request.args as Parameters<
        typeof pipeline.probeEncryptedAudioDuration
      >;
      return pipeline.probeEncryptedAudioDuration(filePath, {
        ...context,
        meetingKey: Buffer.from(context.meetingKey),
      });
    }
    case 'mixEncryptedAudioArtifacts': {
      const [args] = request.args as Parameters<
        typeof pipeline.mixEncryptedAudioArtifacts
      >;
      return pipeline.mixEncryptedAudioArtifacts({
        ...args,
        context: {
          ...args.context,
          meetingKey: Buffer.from(args.context.meetingKey),
        },
      });
    }
    case 'sliceEncryptedAudio': {
      const [args] = request.args as Parameters<
        typeof pipeline.sliceEncryptedAudio
      >;
      return pipeline.sliceEncryptedAudio({
        ...args,
        context: {
          ...args.context,
          meetingKey: Buffer.from(args.context.meetingKey),
        },
      });
    }
    default:
      throw new Error('encrypted_audio_worker_operation_invalid');
  }
};

void execute().then(
  (value) => {
    if (Buffer.isBuffer(value)) {
      // Never transfer a pooled Buffer's backing store with unrelated bytes.
      const bytes = new Uint8Array(value.length);
      bytes.set(value);
      parentPort!.postMessage({ ok: true, value: bytes }, [bytes.buffer]);
    } else parentPort!.postMessage({ ok: true, value });
  },
  (error) =>
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
);
