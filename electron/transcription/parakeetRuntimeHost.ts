import { AsyncResource } from 'node:async_hooks';
import { spawn as nodeSpawn } from 'node:child_process';

import {
  NativeJsonLineProcess,
  type NativeJsonLineTransport,
  type NativeProcessSpawn,
} from './nativeJsonLineProcess';
import type { ParakeetRuntimePaths } from './parakeetFinalClient';

export type ParakeetRuntimeWorkload = 'final' | 'live';

export type ParakeetRuntimeDiagnostics = {
  state: 'idle' | 'final' | 'live';
  activeLeaseCount: number;
  queuedLeaseCount: number;
  durableRetryHandoffCount: number;
};

export type ParakeetRuntimeLease = {
  kind: ParakeetRuntimeWorkload;
  release(): Promise<void>;
  cancelAndPersistForRetry(): Promise<void>;
  setPreemptionHandler(handler: () => Promise<void>): void;
  invalidateWorker(code?: string): Promise<void>;
};

type LeaseRecord = {
  kind: ParakeetRuntimeWorkload;
  released: boolean;
  preempting: boolean;
  preemptionHandler: (() => Promise<void>) | null;
  controller: AbortController;
  admitted: boolean;
  finished: Promise<void>;
  finish: () => void;
  runExclusive?: (
    run: () => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>;
  resolve: (lease: ParakeetRuntimeLease) => void;
  reject: (error: Error) => void;
  lease: ParakeetRuntimeLease;
};

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class ParakeetRuntimeHost {
  readonly transport: NativeJsonLineTransport;
  private readonly process: NativeJsonLineProcess;

  private active: LeaseRecord | null = null;
  private readonly queue: LeaseRecord[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private durableRetryHandoffCount = 0;
  private livePriority = false;
  private closed = false;

  constructor(
    private readonly options: {
      paths: ParakeetRuntimePaths;
      spawn?: NativeProcessSpawn;
      requestTimeoutMs?: number;
      idleTimeoutMs?: number;
      diagnostic?: (code: string) => void;
      persistInterruptedFinalization?: () => Promise<void>;
      liveConfigurationId?: 'pinned-default' | 'low-latency-2s';
      runExclusive?: (
        run: () => Promise<void>,
        signal: AbortSignal,
      ) => Promise<void>;
    },
  ) {
    const liveConfigurationArgs = options.liveConfigurationId
      ? ['--live-config', options.liveConfigurationId]
      : [];
    this.process = new NativeJsonLineProcess({
      executablePath: options.paths.executablePath,
      args: [
        '--model-root',
        options.paths.modelRoot,
        '--audio-root',
        options.paths.audioRoot,
        ...liveConfigurationArgs,
      ],
      spawn: options.spawn ?? (nodeSpawn as NativeProcessSpawn),
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      diagnostic: options.diagnostic,
    });
    this.transport = {
      request: (payload) => this.process.request(payload),
      notify: (payload) => this.process.notify(payload),
      onEvent: (listener) => this.process.onEvent(listener),
      onFailure: (listener) => this.process.onFailure(listener),
      cancelPending: (id) => this.process.cancelPending(id),
      ignoreResponse: (id) => this.process.ignoreResponse(id),
    };
    this.transport.onFailure((code) => {
      if (code !== 'parakeet_process_unloaded')
        this.invalidateActiveLease(code);
    });
  }

  acquire(
    kind: ParakeetRuntimeWorkload,
    signal?: AbortSignal,
  ): Promise<ParakeetRuntimeLease> {
    if (signal?.aborted) return Promise.reject(new Error('parakeet_cancelled'));
    if (this.closed)
      return Promise.reject(new Error('parakeet_runtime_closed'));
    if (kind === 'final' && this.livePriority) {
      return this.persistRejectedFinal();
    }
    this.clearIdleTimer();
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const record = this.makeRecord(
        kind,
        (lease) => {
          cleanup();
          resolve(lease);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
      const abort = () => {
        const index = this.queue.indexOf(record);
        if (index < 0) {
          if (this.active === record && !record.admitted) {
            record.reject(new Error('parakeet_cancelled'));
            void this.release(record);
          }
          return;
        }
        this.queue.splice(index, 1);
        record.released = true;
        record.reject(new Error('parakeet_cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(record);
      this.drain();
    });
  }

  tryAcquire(kind: ParakeetRuntimeWorkload): ParakeetRuntimeLease | null {
    if (
      this.options.runExclusive ||
      this.closed ||
      this.active ||
      this.queue.length > 0
    )
      return null;
    this.clearIdleTimer();
    const record = this.makeRecord(
      kind,
      () => undefined,
      () => undefined,
    );
    this.process.start();
    record.admitted = true;
    this.active = record;
    return record.lease;
  }

  async startRecordingLive(
    signal?: AbortSignal,
  ): Promise<ParakeetRuntimeLease> {
    signal?.throwIfAborted();
    this.livePriority = true;
    const queuedFinals = this.queue.filter((record) => record.kind === 'final');
    for (const record of queuedFinals) {
      record.released = true;
      this.queue.splice(this.queue.indexOf(record), 1);
      this.durableRetryHandoffCount += 1;
      try {
        await this.options.persistInterruptedFinalization?.();
      } finally {
        this.durableRetryHandoffCount = Math.max(
          0,
          this.durableRetryHandoffCount - 1,
        );
      }
      record.reject(new Error('parakeet_cancelled'));
    }
    try {
      if (this.active?.kind === 'final') {
        await this.active.lease.cancelAndPersistForRetry();
      }
      return await this.acquire('live', signal);
    } finally {
      this.livePriority = false;
    }
  }

  private async persistRejectedFinal(): Promise<never> {
    this.durableRetryHandoffCount += 1;
    try {
      await this.options.persistInterruptedFinalization?.();
    } finally {
      this.durableRetryHandoffCount = Math.max(
        0,
        this.durableRetryHandoffCount - 1,
      );
    }
    throw new Error('parakeet_cancelled');
  }

  diagnostics(): ParakeetRuntimeDiagnostics {
    return {
      state: this.active?.kind ?? 'idle',
      activeLeaseCount: this.active ? 1 : 0,
      queuedLeaseCount: this.queue.length,
      durableRetryHandoffCount: this.durableRetryHandoffCount,
    };
  }

  async unloadIdleModels(): Promise<void> {
    if (this.active?.admitted && !this.active.released)
      throw new Error('parakeet_runtime_busy');
    this.clearIdleTimer();
    await this.process.terminateAndWait();
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    const error = new Error('parakeet_runtime_closed');
    for (const record of this.queue.splice(0)) record.reject(error);
    const active = this.active;
    this.active = null;
    if (active) {
      active.released = true;
      active.controller.abort(new Error('parakeet_runtime_closed'));
      active.finish();
      if (!active.admitted) active.reject(error);
    }
    this.process.terminate();
  }

  private async cancelAndPersist(record: LeaseRecord): Promise<void> {
    if (record.kind !== 'final') {
      await this.release(record);
      return;
    }
    if (record.preempting) return;
    record.preempting = true;
    this.durableRetryHandoffCount += 1;
    try {
      await record.preemptionHandler?.();
      await this.options.persistInterruptedFinalization?.();
    } finally {
      record.preempting = false;
      this.durableRetryHandoffCount = Math.max(
        0,
        this.durableRetryHandoffCount - 1,
      );
      await this.release(record);
    }
  }

  private async release(record: LeaseRecord): Promise<void> {
    if (record.released) return record.finished;
    if (record.preempting) return;
    record.released = true;
    if (record.admitted && record.runExclusive)
      await this.process.waitForStoppedChildren();
    record.controller.abort(new Error('parakeet_cancelled'));
    record.finish();
    if (this.active === record) this.active = null;
    else {
      const index = this.queue.indexOf(record);
      if (index >= 0) this.queue.splice(index, 1);
    }
    this.drain();
  }

  private makeRecord(
    kind: ParakeetRuntimeWorkload,
    resolve: (lease: ParakeetRuntimeLease) => void,
    reject: (error: Error) => void,
  ): LeaseRecord {
    const record = {} as LeaseRecord;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const lease: ParakeetRuntimeLease = {
      kind,
      release: async () => this.release(record),
      cancelAndPersistForRetry: async () => this.cancelAndPersist(record),
      setPreemptionHandler: (handler) => {
        record.preemptionHandler = handler;
      },
      invalidateWorker: async (code) =>
        this.invalidateWorkerForLease(record, code),
    };
    Object.assign(record, {
      kind,
      released: false,
      preempting: false,
      preemptionHandler: null,
      controller: new AbortController(),
      admitted: false,
      finished,
      finish,
      runExclusive: this.options.runExclusive
        ? AsyncResource.bind(this.options.runExclusive)
        : undefined,
      resolve,
      reject,
      lease,
    });
    return record;
  }

  private async invalidateWorkerForLease(
    record: LeaseRecord,
    code = 'parakeet_cleanup_timeout',
  ): Promise<void> {
    if (this.active !== record || record.released) return;
    record.released = true;
    record.controller.abort(new Error(code));
    this.options.diagnostic?.(code);
    this.process.terminate();
    await this.process.terminateAndWait();
    record.finish();
    this.active = null;
    this.drain();
  }

  private drain(): void {
    if (this.closed || this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.scheduleIdleUnload();
      return;
    }
    this.active = next;
    const start = () => {
      this.process.start();
      next.admitted = true;
      next.resolve(next.lease);
    };
    if (!next.runExclusive) {
      start();
      return;
    }
    void next
      .runExclusive(async () => {
        if (next.released || this.closed) return;
        try {
          start();
          await next.finished;
        } finally {
          await this.process.waitForStoppedChildren();
        }
      }, next.controller.signal)
      .catch((error) => {
        if (next.released) return;
        next.reject(
          error instanceof Error
            ? error
            : new Error('parakeet_admission_failed'),
        );
        void this.release(next);
      });
  }

  private invalidateActiveLease(code: string): void {
    const active = this.active;
    if (!active || active.released) return;
    this.options.diagnostic?.(code);
    void this.release(active);
  }

  private scheduleIdleUnload(): void {
    if (
      this.closed ||
      this.idleTimer ||
      this.active ||
      this.queue.length > 0 ||
      this.durableRetryHandoffCount > 0
    ) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (
        !this.active &&
        this.queue.length === 0 &&
        this.durableRetryHandoffCount === 0
      ) {
        this.process.terminate();
      }
    }, this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

export const makeRuntimeHost = (
  options: ConstructorParameters<typeof ParakeetRuntimeHost>[0],
) => new ParakeetRuntimeHost(options);
