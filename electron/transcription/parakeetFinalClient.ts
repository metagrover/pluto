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
  NativePreparationProgressEvent,
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

export type SpeakerEvidenceRequest = {
  mixedAudioPath: string;
  micAudioPath: string;
  systemAudioPath: string;
  signal?: AbortSignal;
};

export type SpeakerEvidenceResult = {
  turns: Array<{ startTime: number; endTime: number; cluster: string }>;
  energyWindows: Array<{
    startTime: number;
    endTime: number;
    micRms: number;
    systemRms: number;
  }>;
  provenance: {
    modelIdentifier: string;
    modelRevision: string;
    artifactDigest: string;
    runtimeVersion: string;
  };
  timings: {
    diarizationMs: number;
    energyAnalysisMs: number;
    totalMs: number;
  };
  windowSeconds: number;
};

type FinalLeaseReservation = { lease: ParakeetRuntimeLease } | { error: Error };
export type ParakeetPreparationProgress = Pick<
  NativePreparationProgressEvent,
  'phase' | 'downloadedBytes' | 'totalBytes'
>;
type PreparationProgressListener = (
  progress: ParakeetPreparationProgress,
) => void;

export class ParakeetFinalClient {
  private readonly runtimeHost: ParakeetRuntimeHost;
  private preparePromise: Promise<TranscriptionRuntimeHealth> | null = null;
  private preparedCapability: TranscriptionRuntimeHealth | null = null;
  private activePrepare: {
    id: string;
    settled: Promise<void>;
    progressListeners: Set<PreparationProgressListener>;
  } | null = null;
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
    this.runtimeHost.transport.onEvent((event) => {
      if (event.event !== 'prepare_progress') return;
      const activePrepare = this.activePrepare;
      if (!activePrepare || activePrepare.id !== event.requestId) return;
      const progress = {
        phase: event.phase,
        downloadedBytes: event.downloadedBytes,
        totalBytes: event.totalBytes,
      };
      for (const listener of activePrepare.progressListeners)
        listener(progress);
    });
  }

  getPreparedCapability(): TranscriptionRuntimeHealth | null {
    return this.preparedCapability;
  }

  prepare(
    onProgress?: PreparationProgressListener,
  ): Promise<TranscriptionRuntimeHealth> {
    const lease = this.runtimeHost.tryAcquire('final');
    if (lease) return this.prepareInLease(lease, onProgress);
    return this.runtimeHost
      .acquire('final')
      .then((nextLease) => this.prepareInLease(nextLease, onProgress));
  }

  private async prepareInLease(
    lease: Awaited<ReturnType<ParakeetRuntimeHost['acquire']>>,
    onProgress?: PreparationProgressListener,
  ): Promise<TranscriptionRuntimeHealth> {
    let preempted = false;
    lease.setPreemptionHandler(async () => {
      preempted = true;
      await this.cancelAndSettleActivePrepare();
    });
    try {
      const health = await this.prepareWithLease(onProgress);
      if (preempted) throw new Error('parakeet_cancelled');
      return health;
    } finally {
      await lease.release();
    }
  }

  private prepareWithLease(
    onProgress?: PreparationProgressListener,
  ): Promise<TranscriptionRuntimeHealth> {
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
        progressListeners: new Set<PreparationProgressListener>(),
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
    const preparation = this.preparePromise;
    const activePrepare = this.activePrepare;
    if (!onProgress || !activePrepare) return preparation;
    activePrepare.progressListeners.add(onProgress);
    return preparation.finally(() => {
      activePrepare.progressListeners.delete(onProgress);
    });
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

  speakerEvidence(
    request: SpeakerEvidenceRequest,
  ): Promise<SpeakerEvidenceResult> {
    if (
      !this.isApprovedAudioPath(request.mixedAudioPath) ||
      !this.isApprovedAudioPath(request.micAudioPath) ||
      !this.isApprovedAudioPath(request.systemAudioPath)
    ) {
      return Promise.reject(new Error('parakeet_path_not_allowed'));
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
      () => this.runSpeakerEvidence(request, reservation),
      () => this.runSpeakerEvidence(request, reservation),
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

  private async runSpeakerEvidence(
    request: SpeakerEvidenceRequest,
    reservation: Promise<FinalLeaseReservation>,
  ): Promise<SpeakerEvidenceResult> {
    const acquired = await reservation;
    if ('error' in acquired) throw acquired.error;
    const lease = acquired.lease;
    const id = this.requestID('speaker-evidence');
    let settled: Promise<void> | null = null;
    const cancel = () => {
      const cancelID = this.requestID('cancel');
      this.runtimeHost.transport.ignoreResponse(cancelID);
      this.runtimeHost.transport.notify({
        schemaVersion: 1,
        id: cancelID,
        method: 'cancel',
        targetId: id,
      });
    };
    try {
      if (request.signal?.aborted) throw new Error('parakeet_cancelled');
      lease.setPreemptionHandler(async () => {
        const cancelID = this.requestID('cancel');
        const response = await this.runtimeHost.transport.request({
          schemaVersion: 1,
          id: cancelID,
          method: 'cancel',
          targetId: id,
        });
        if (!response.ok && response.error?.code !== 'parakeet_cancelled') {
          this.requireSuccess(response);
        }
        if (!settled) throw new Error('parakeet_protocol_invalid');
        await settled;
      });
      request.signal?.addEventListener('abort', cancel, { once: true });
      const nativeRequest = this.runtimeHost.transport.request({
        schemaVersion: 1,
        id,
        method: 'speaker_evidence',
        mixedAudioPath: request.mixedAudioPath,
        micAudioPath: request.micAudioPath,
        systemAudioPath: request.systemAudioPath,
      });
      settled = nativeRequest.then(
        () => undefined,
        () => undefined,
      );
      const result = this.requireSuccess(await nativeRequest);
      return this.parseSpeakerEvidence(result.speakerEvidence);
    } finally {
      request.signal?.removeEventListener('abort', cancel);
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

  private parseSpeakerEvidence(value: unknown): SpeakerEvidenceResult {
    if (!value || typeof value !== 'object') {
      throw new Error('parakeet_protocol_invalid');
    }
    const candidate = value as Partial<SpeakerEvidenceResult>;
    const finiteRange = (entry: { startTime?: unknown; endTime?: unknown }) =>
      Number.isFinite(entry.startTime) &&
      Number.isFinite(entry.endTime) &&
      Number(entry.startTime) >= 0 &&
      Number(entry.endTime) > Number(entry.startTime);
    const turnsValid =
      Array.isArray(candidate.turns) &&
      candidate.turns.every(
        (turn) =>
          finiteRange(turn) &&
          typeof turn.cluster === 'string' &&
          turn.cluster.length > 0,
      );
    const windowsValid =
      Array.isArray(candidate.energyWindows) &&
      candidate.energyWindows.length > 0 &&
      candidate.energyWindows.every(
        (window) =>
          finiteRange(window) &&
          Number.isFinite(window.micRms) &&
          Number.isFinite(window.systemRms) &&
          window.micRms >= 0 &&
          window.systemRms >= 0,
      );
    const provenance = candidate.provenance;
    const timings = candidate.timings;
    const hex = (text: string, length: number) =>
      text.length === length && /^[a-f0-9]+$/i.test(text);
    if (
      !turnsValid ||
      !windowsValid ||
      !provenance ||
      typeof provenance.modelIdentifier !== 'string' ||
      !hex(provenance.modelRevision, 40) ||
      !hex(provenance.artifactDigest, 64) ||
      typeof provenance.runtimeVersion !== 'string' ||
      !timings ||
      !Number.isFinite(timings.diarizationMs) ||
      !Number.isFinite(timings.energyAnalysisMs) ||
      !Number.isFinite(timings.totalMs) ||
      timings.diarizationMs < 0 ||
      timings.energyAnalysisMs < 0 ||
      timings.totalMs < 0 ||
      !Number.isFinite(candidate.windowSeconds) ||
      Number(candidate.windowSeconds) <= 0
    ) {
      throw new Error('parakeet_protocol_invalid');
    }
    return candidate as SpeakerEvidenceResult;
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
