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
};

type LeaseRecord = {
  kind: ParakeetRuntimeWorkload;
  released: boolean;
  preempting: boolean;
  preemptionHandler: (() => Promise<void>) | null;
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
    this.transport.onFailure((code) => this.invalidateActiveLease(code));
  }

  acquire(kind: ParakeetRuntimeWorkload): Promise<ParakeetRuntimeLease> {
    if (this.closed)
      return Promise.reject(new Error('parakeet_runtime_closed'));
    if (kind === 'final' && this.livePriority) {
      return this.persistRejectedFinal();
    }
    this.clearIdleTimer();
    return new Promise((resolve, reject) => {
      const record = this.makeRecord(kind, resolve, reject);
      this.queue.push(record);
      this.drain();
    });
  }

  tryAcquire(kind: ParakeetRuntimeWorkload): ParakeetRuntimeLease | null {
    if (this.closed || this.active || this.queue.length > 0) return null;
    this.clearIdleTimer();
    const record = this.makeRecord(
      kind,
      () => undefined,
      () => undefined,
    );
    this.process.start();
    this.active = record;
    return record.lease;
  }

  async startRecordingLive(): Promise<ParakeetRuntimeLease> {
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
      return await this.acquire('live');
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

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    const error = new Error('parakeet_runtime_closed');
    for (const record of this.queue.splice(0)) record.reject(error);
    this.active = null;
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
    if (record.released) return;
    if (record.preempting) return;
    record.released = true;
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
    const lease: ParakeetRuntimeLease = {
      kind,
      release: async () => this.release(record),
      cancelAndPersistForRetry: async () => this.cancelAndPersist(record),
      setPreemptionHandler: (handler) => {
        record.preemptionHandler = handler;
      },
    };
    Object.assign(record, {
      kind,
      released: false,
      preempting: false,
      preemptionHandler: null,
      resolve,
      reject,
      lease,
    });
    return record;
  }

  private drain(): void {
    if (this.closed || this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.scheduleIdleUnload();
      return;
    }
    this.process.start();
    this.active = next;
    next.resolve(next.lease);
  }

  private invalidateActiveLease(code: string): void {
    const active = this.active;
    if (!active || active.released) return;
    active.released = true;
    this.active = null;
    this.options.diagnostic?.(code);
    this.drain();
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
