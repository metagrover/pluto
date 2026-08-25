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
  type ParakeetRuntimeLease,
  makeRuntimeHost,
} from './parakeetRuntimeHost';

export type ParakeetRuntimePaths = {
  executablePath: string | (() => string);
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

type FinalLeaseReservation = { lease: ParakeetRuntimeLease } | { error: Error };

export class ParakeetFinalClient {
  private readonly runtimeHost: ParakeetRuntimeHost;
  private preparePromise: Promise<TranscriptionRuntimeHealth> | null = null;
  private preparedCapability: TranscriptionRuntimeHealth | null = null;
  private activePrepare: { id: string; settled: Promise<void> } | null = null;
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
    this.runtimeHost.transport.onFailure(() => {
      this.preparePromise = null;
      this.preparedCapability = null;
    });
  }

  getPreparedCapability(): TranscriptionRuntimeHealth | null {
    return this.preparedCapability;
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
    let preempted = false;
    lease.setPreemptionHandler(async () => {
      preempted = true;
      await this.cancelAndSettleActivePrepare();
    });
    try {
      const health = await this.prepareWithLease();
      if (preempted) throw new Error('parakeet_cancelled');
      return health;
    } finally {
      await lease.release();
    }
  }

  private prepareWithLease(): Promise<TranscriptionRuntimeHealth> {
    if (!this.preparePromise) {
      const id = this.requestID('prepare');
      const nativeRequest = this.runtimeHost.transport.request({
        schemaVersion: 1,
        id,
        method: 'prepare',
        modelRoot: this.options.paths.modelRoot,
      });
      const activePrepare = {
        id,
        settled: nativeRequest.then(
          () => undefined,
          () => undefined,
        ),
      };
      this.activePrepare = activePrepare;
      this.preparePromise = nativeRequest
        .then((response) => {
          const result = this.requireSuccess(response);
          const modelVersion = result.modelVersion;
          if (typeof modelVersion !== 'string' || modelVersion.length === 0) {
            throw new Error('parakeet_protocol_invalid');
          }
          const capability = {
            ready: true,
            engine: 'parakeet_coreml' as const,
            liveEngine: 'parakeet_eou_320ms' as const,
            modelVersion,
            providerVersion: 'FluidAudio-0.15.5',
            modelBundleVersion: modelVersion,
          };
          this.preparedCapability = capability;
          return capability;
        })
        .catch((error) => {
          this.preparePromise = null;
          this.preparedCapability = null;
          throw error;
        })
        .finally(() => {
          if (this.activePrepare === activePrepare) {
            this.activePrepare = null;
          }
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
    const reservation: Promise<FinalLeaseReservation> = this.runtimeHost
      .acquire('final')
      .then(
        (lease) => ({ lease }),
        (error: unknown) => ({
          error:
            error instanceof Error
              ? error
              : new Error('parakeet_runtime_unavailable'),
        }),
      );
    const queuedRun = this.queue.then(
      () => this.runTranscription(request, reservation),
      () => this.runTranscription(request, reservation),
    );
    const preemption = reservation.then((acquired) => {
      if ('error' in acquired) throw acquired.error;
      return new Promise<never>(() => undefined);
    });
    const run = Promise.race([queuedRun, preemption]);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close(): void {
    this.preparePromise = null;
    this.preparedCapability = null;
  }

  private async runTranscription(
    request: TranscriptionRequest,
    reservation: Promise<FinalLeaseReservation>,
  ): Promise<TranscriptionResult> {
    const acquired = await reservation;
    if ('error' in acquired) throw acquired.error;
    const lease = acquired.lease;
    try {
      if (request.signal?.aborted) throw new Error('parakeet_cancelled');
      let preempted = false;
      lease.setPreemptionHandler(async () => {
        preempted = true;
        await this.cancelAndSettleActivePrepare();
      });
      const health = await this.prepareWithLease();
      if (preempted || request.signal?.aborted) {
        throw new Error('parakeet_cancelled');
      }
      const id = this.requestID('transcribe');
      let transcriptionSettled: Promise<void> | null = null;
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
      };
      lease.setPreemptionHandler(async () => {
        const cancelID = this.requestID('cancel');
        const cancellation = this.runtimeHost.transport.request({
          schemaVersion: 1,
          id: cancelID,
          method: 'cancel',
          targetId: id,
        });
        const cancellationResponse = await cancellation;
        if (
          !cancellationResponse.ok &&
          cancellationResponse.error?.code !== 'parakeet_cancelled'
        ) {
          this.requireSuccess(cancellationResponse);
        }
        if (!transcriptionSettled) throw new Error('parakeet_protocol_invalid');
        await transcriptionSettled;
      });
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        const nativeRequest = this.runtimeHost.transport.request({
          schemaVersion: 1,
          id,
          method: 'transcribe',
          audioPath: request.audioPath,
          language: request.language,
          vocabulary: request.vocabulary ?? [],
        });
        transcriptionSettled = nativeRequest.then(
          () => undefined,
          () => undefined,
        );
        const response = await nativeRequest;
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

  private async cancelAndSettleActivePrepare(): Promise<void> {
    const activePrepare = this.activePrepare;
    if (!activePrepare) return;
    const cancelID = this.requestID('cancel');
    const cancellation = await this.runtimeHost.transport.request({
      schemaVersion: 1,
      id: cancelID,
      method: 'cancel',
      targetId: activePrepare.id,
    });
    if (!cancellation.ok && cancellation.error?.code !== 'parakeet_cancelled') {
      this.requireSuccess(cancellation);
    }
    await activePrepare.settled;
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
