import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { resolveUnpackedExecutablePath } from '../packagedExecutablePath.ts';
import type * as implementation from './encryptedAudioPipelineImpl';

const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

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
    const options = typeof args[0] === 'object' ? args[0] : undefined;
    const signal = options && 'signal' in options ? options.signal : undefined;
    // AbortSignals are not structured-cloneable. Forward cancellation as a
    // message so the worker can clean up partial bundles before it exits.
    const workerArgs =
      options && 'signal' in options
        ? [{ ...options, signal: undefined }]
        : args;
    const result = tail.then(async () => {
      signal?.throwIfAborted();
      const worker = new Worker(workerPath, {
        workerData: { operation, args: workerArgs },
      });
      const onAbort = () => worker.postMessage('abort');
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return await new Promise((resolve, reject) => {
          worker.once('message', (message) => {
            if (!message.ok) {
              const error = new Error(message.error);
              error.name = message.name ?? 'Error';
              reject(error);
            } else {
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
        signal?.removeEventListener('abort', onAbort);
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
    path.join(currentDir, 'encryptedAudioWorker.js'),
  ),
);
