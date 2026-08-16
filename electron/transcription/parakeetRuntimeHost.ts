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
  process: NativeJsonLineTransport;
  release(): Promise<void>;
  cancelAndPersistForRetry(): Promise<void>;
  setPreemptionHandler(handler: () => Promise<void>): void;
};

type LeaseRecord = {
  kind: ParakeetRuntimeWorkload;
  released: boolean;
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
    this.transport = this.process;
    this.transport.onFailure((code) => this.invalidateActiveLease(code));
  }

  acquire(kind: ParakeetRuntimeWorkload): Promise<ParakeetRuntimeLease> {
    if (this.closed)
      return Promise.reject(new Error('parakeet_runtime_closed'));
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
    if (this.active?.kind === 'final') {
      await this.active.lease.cancelAndPersistForRetry();
    }
    return this.acquire('live');
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
    this.transport.terminate();
  }

  private async cancelAndPersist(record: LeaseRecord): Promise<void> {
    if (record.kind !== 'final') {
      await this.release(record);
      return;
    }
    this.durableRetryHandoffCount += 1;
    try {
      await record.preemptionHandler?.();
      await this.options.persistInterruptedFinalization?.();
    } finally {
      this.durableRetryHandoffCount = Math.max(
        0,
        this.durableRetryHandoffCount - 1,
      );
      await this.release(record);
    }
  }

  private async release(record: LeaseRecord): Promise<void> {
    if (record.released) return;
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
      process: this.transport,
      release: async () => this.release(record),
      cancelAndPersistForRetry: async () => this.cancelAndPersist(record),
      setPreemptionHandler: (handler) => {
        record.preemptionHandler = handler;
      },
    };
    Object.assign(record, {
      kind,
      released: false,
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
        this.transport.terminate();
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
