import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

import { segmentRecognizedWords } from '../../src/services/finalTranscription/segmentRecognizedWords';
import type {
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionRuntimeHealth,
  TranscriptionWord,
} from '../../src/services/transcription/contracts';
import type {
  NativeProcessSpawn,
  NativeResponse,
} from './nativeJsonLineProcess';
import {
  type ParakeetRuntimeHost,
  makeRuntimeHost,
} from './parakeetRuntimeHost';

export type ParakeetRuntimePaths = {
  executablePath: string;
  modelRoot: string;
  audioRoot: string;
};

type NativeTranscription = {
  text: string;
  confidence: number;
  durationSeconds: number;
  words: Array<{
    text: string;
    startSeconds: number;
    endSeconds: number;
    confidence?: number;
  }>;
  noSpeech: boolean;
};

export class ParakeetFinalClient {
  private readonly runtimeHost: ParakeetRuntimeHost;
  private preparePromise: Promise<TranscriptionRuntimeHealth> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private nextID = 0;

  constructor(
    private readonly options: {
      paths: ParakeetRuntimePaths;
      spawn?: NativeProcessSpawn;
      requestTimeoutMs?: number;
      idleTimeoutMs?: number;
      diagnostic?: (code: string) => void;
      now?: () => number;
      runtimeHost?: ParakeetRuntimeHost;
    },
  ) {
    this.runtimeHost =
      options.runtimeHost ??
      makeRuntimeHost({
        paths: options.paths,
        spawn: options.spawn ?? (nodeSpawn as NativeProcessSpawn),
        requestTimeoutMs: options.requestTimeoutMs,
        idleTimeoutMs: options.idleTimeoutMs,
        diagnostic: options.diagnostic,
      });
  }

  prepare(): Promise<TranscriptionRuntimeHealth> {
    const lease = this.runtimeHost.tryAcquire('final');
    if (lease) return this.prepareInLease(lease);
    return this.runtimeHost
      .acquire('final')
      .then((nextLease) => this.prepareInLease(nextLease));
  }

  private async prepareInLease(
    lease: Awaited<ReturnType<ParakeetRuntimeHost['acquire']>>,
  ): Promise<TranscriptionRuntimeHealth> {
    try {
      return await this.prepareWithLease();
    } finally {
      await lease.release();
    }
  }

  private prepareWithLease(): Promise<TranscriptionRuntimeHealth> {
    if (!this.preparePromise) {
      const id = this.requestID('prepare');
      this.preparePromise = this.runtimeHost.transport
        .request({
          schemaVersion: 1,
          id,
          method: 'prepare',
          modelRoot: this.options.paths.modelRoot,
        })
        .then((response) => {
          const result = this.requireSuccess(response);
          const modelVersion = result.modelVersion;
          if (typeof modelVersion !== 'string' || modelVersion.length === 0) {
            throw new Error('parakeet_protocol_invalid');
          }
          return {
            ready: true,
            engine: 'parakeet_coreml' as const,
            providerVersion: 'FluidAudio-0.15.5',
            modelBundleVersion: modelVersion,
          };
        })
        .catch((error) => {
          this.preparePromise = null;
          throw error;
        });
    }
    return this.preparePromise;
  }

  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (!this.isApprovedAudioPath(request.audioPath)) {
      return Promise.reject(new Error('parakeet_path_not_allowed'));
    }
    if (request.role !== 'final_validation') {
      return Promise.reject(new Error('parakeet_request_invalid'));
    }
    const run = this.queue.then(
      () => this.runTranscription(request),
      () => this.runTranscription(request),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close(): void {
    this.preparePromise = null;
  }

  private async runTranscription(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    const lease = await this.runtimeHost.acquire('final');
    try {
      if (request.signal?.aborted) throw new Error('parakeet_cancelled');
      const health = await this.prepareWithLease();
      if (request.signal?.aborted) throw new Error('parakeet_cancelled');
      const id = this.requestID('transcribe');
      const startedAt = (this.options.now ?? Date.now)();
      const abort = () => {
        const cancelID = this.requestID('cancel');
        this.runtimeHost.transport.ignoreResponse(cancelID);
        this.runtimeHost.transport.notify({
          schemaVersion: 1,
          id: cancelID,
          method: 'cancel',
          targetId: id,
        });
        this.runtimeHost.transport.cancelPending(id);
      };
      lease.setPreemptionHandler(async () => {
        const cancelID = this.requestID('cancel');
        const cancellation = this.runtimeHost.transport.request({
          schemaVersion: 1,
          id: cancelID,
          method: 'cancel',
          targetId: id,
        });
        this.runtimeHost.transport.cancelPending(id);
        this.requireSuccess(await cancellation);
      });
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        const response = await this.runtimeHost.transport.request({
          schemaVersion: 1,
          id,
          method: 'transcribe',
          audioPath: request.audioPath,
          language: request.language,
          vocabulary: request.vocabulary ?? [],
        });
        const result = this.requireSuccess(response);
        const transcription = this.parseTranscription(result.transcription);
        const words: TranscriptionWord[] = transcription.words.map((word) => ({
          word: word.text,
          start: word.startSeconds,
          end: word.endSeconds,
          confidence: word.confidence,
        }));
        const segments = segmentRecognizedWords(
          transcription.noSpeech ? [] : words,
          transcription.durationSeconds,
        );
        return {
          segments,
          language: request.language,
          duration: transcription.durationSeconds,
          vad: {
            status: transcription.noSpeech ? 'no_speech' : 'speech',
            speechSeconds: transcription.noSpeech
              ? 0
              : transcription.durationSeconds,
          },
          meta: {
            role: 'final_validation',
            engine: 'parakeet_coreml',
            model: 'parakeet-tdt-0.6b-v3',
            providerVersion: health.providerVersion ?? 'FluidAudio-0.15.5',
            modelBundleVersion: health.modelBundleVersion,
            language: request.language,
            source: request.source,
            elapsedMs: (this.options.now ?? Date.now)() - startedAt,
            confidence: transcription.confidence,
            vocabularyPolicyVersion: request.vocabularyPolicyVersion,
            vocabularyCount:
              typeof result.vocabularyCount === 'number'
                ? result.vocabularyCount
                : 0,
          },
        };
      } finally {
        request.signal?.removeEventListener('abort', abort);
      }
    } finally {
      await lease.release();
    }
  }

  private requireSuccess(response: NativeResponse): Record<string, unknown> {
    if (!response.ok) {
      const code = response.error?.code;
      throw new Error(
        typeof code === 'string' && code.startsWith('parakeet_')
          ? code
          : 'parakeet_native_failed',
      );
    }
    if (!response.result || typeof response.result !== 'object') {
      throw new Error('parakeet_protocol_invalid');
    }
    return response.result;
  }

  private parseTranscription(value: unknown): NativeTranscription {
    if (!value || typeof value !== 'object')
      throw new Error('parakeet_protocol_invalid');
    const candidate = value as NativeTranscription;
    if (
      typeof candidate.text !== 'string' ||
      !Number.isFinite(candidate.confidence) ||
      !Number.isFinite(candidate.durationSeconds) ||
      !Array.isArray(candidate.words) ||
      typeof candidate.noSpeech !== 'boolean'
    )
      throw new Error('parakeet_protocol_invalid');
    return candidate;
  }

  private isApprovedAudioPath(audioPath: string): boolean {
    const root = path.resolve(this.options.paths.audioRoot);
    const candidate = path.resolve(audioPath);
    const relative = path.relative(root, candidate);
    return (
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    );
  }

  private requestID(prefix: string): string {
    this.nextID += 1;
    return `${prefix}-${this.nextID}`;
  }
}
