import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { resolveUnpackedExecutablePath } from '../packagedExecutablePath';
import type * as implementation from './encryptedAudioPipelineImpl';

type Pipeline = Pick<
  typeof implementation,
  | 'materializeEncryptedJournalSource'
  | 'repairEncryptedJournalRawChunk'
  | 'mixEncryptedAudioArtifacts'
  | 'probeEncryptedAudioDuration'
  | 'sliceEncryptedAudio'
>;
export type AudioOperation = keyof Pipeline;
export type AudioRequest<K extends AudioOperation = AudioOperation> = {
  operation: K;
  args: Parameters<Pipeline[K]>;
};

// Serialize whole-recording jobs so their large buffers do not compete with
// capture and local inference for hundreds of MB.
export function createEncryptedAudioPipeline(workerPath: string): Pipeline {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <K extends AudioOperation>(
    operation: K,
    ...args: Parameters<Pipeline[K]>
  ): ReturnType<Pipeline[K]> => {
    const result = tail.then(async () => {
      const worker = new Worker(workerPath, {
        workerData: { operation, args } satisfies AudioRequest<K>,
      });
      try {
        return await new Promise((resolve, reject) => {
          worker.once('message', (message) => {
            if (!message.ok) reject(new Error(message.error));
            else {
              const value = message.value;
              resolve(
                value instanceof Uint8Array
                  ? Buffer.from(
                      value.buffer,
                      value.byteOffset,
                      value.byteLength,
                    )
                  : value,
              );
            }
          });
          worker.once('error', reject);
          worker.once('exit', (code) => {
            reject(new Error(`encrypted_audio_worker_exited:${code}`));
          });
        });
      } finally {
        // Release plaintext and key copies before starting another job.
        await worker.terminate();
      }
    });
    tail = result.catch(() => undefined);
    return result as ReturnType<Pipeline[K]>;
  };
  return {
    materializeEncryptedJournalSource: (...args) =>
      run('materializeEncryptedJournalSource', ...args),
    repairEncryptedJournalRawChunk: (...args) =>
      run('repairEncryptedJournalRawChunk', ...args),
    mixEncryptedAudioArtifacts: (...args) =>
      run('mixEncryptedAudioArtifacts', ...args),
    probeEncryptedAudioDuration: (...args) =>
      run('probeEncryptedAudioDuration', ...args),
    sliceEncryptedAudio: (...args) => run('sliceEncryptedAudio', ...args),
  };
}

export const {
  materializeEncryptedJournalSource,
  repairEncryptedJournalRawChunk,
  mixEncryptedAudioArtifacts,
  probeEncryptedAudioDuration,
  sliceEncryptedAudio,
} = createEncryptedAudioPipeline(
  resolveUnpackedExecutablePath(
    path.join(__dirname, 'encryptedAudioWorker.js'),
  ),
);
