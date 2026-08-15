import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

import { segmentRecognizedWords } from '../../src/services/finalTranscription/segmentRecognizedWords';
import type {
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionRuntimeHealth,
  TranscriptionWord,
} from '../../src/services/transcription/contracts';
import {
  NativeJsonLineProcess,
  type NativeProcessSpawn,
  type NativeResponse,
} from './nativeJsonLineProcess';

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

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class ParakeetFinalClient {
  private readonly process: NativeJsonLineProcess;
  private preparePromise: Promise<TranscriptionRuntimeHealth> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private nextID = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      paths: ParakeetRuntimePaths;
      spawn?: NativeProcessSpawn;
      requestTimeoutMs?: number;
      idleTimeoutMs?: number;
      diagnostic?: (code: string) => void;
      now?: () => number;
    },
  ) {
    this.process = new NativeJsonLineProcess({
      executablePath: options.paths.executablePath,
      args: [
        '--model-root',
        options.paths.modelRoot,
        '--audio-root',
        options.paths.audioRoot,
      ],
      spawn: options.spawn ?? (nodeSpawn as NativeProcessSpawn),
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      diagnostic: options.diagnostic,
    });
  }

  prepare(): Promise<TranscriptionRuntimeHealth> {
    this.clearIdleTimer();
    if (!this.preparePromise) {
      const id = this.requestID('prepare');
      this.preparePromise = this.process
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
    this.clearIdleTimer();
    this.process.terminate();
    this.preparePromise = null;
  }

  private async runTranscription(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (request.signal?.aborted) throw new Error('parakeet_cancelled');
    const health = await this.prepare();
    if (request.signal?.aborted) throw new Error('parakeet_cancelled');
    const id = this.requestID('transcribe');
    const startedAt = (this.options.now ?? Date.now)();
    const abort = () => {
      const cancelID = this.requestID('cancel');
      this.process.ignoreResponse(cancelID);
      this.process.notify({
        schemaVersion: 1,
        id: cancelID,
        method: 'cancel',
        targetId: id,
      });
      this.process.cancelPending(id);
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.process.request({
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
      this.scheduleIdleUnload();
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

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private scheduleIdleUnload(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(
      () => this.close(),
      this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    );
  }
}
