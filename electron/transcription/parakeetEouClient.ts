import { type EouPcmAppend, encodeEouPcmAppend } from './eouPcmContract';
import type {
  NativeEouUpdateEvent,
  NativeEvent,
  NativeJsonLineTransport,
  NativeLiveSource,
  NativeResponse,
} from './nativeJsonLineProcess';
import type {
  ParakeetRuntimeHost,
  ParakeetRuntimeLease,
} from './parakeetRuntimeHost';

export type ParakeetEouIdentity = {
  streamId: string;
  source: NativeLiveSource;
  generation: number;
};

type AppendJob = {
  request: EouPcmAppend;
  resolve: () => void;
  reject: (error: Error) => void;
};

type DrainWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type StreamState = ParakeetEouIdentity & {
  nextSequence: number;
  nextRevision: number;
  queue: AppendJob[];
  inFlight: AppendJob | null;
  drainWaiters: DrainWaiter[];
  closing: boolean;
};

const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export class ParakeetEouClient {
  private readonly process: NativeJsonLineTransport;
  private readonly streams = new Map<string, StreamState>();
  private readonly sourceStreams = new Map<NativeLiveSource, string>();
  private readonly updateListeners = new Set<
    (event: NativeEouUpdateEvent) => void
  >();
  private readonly terminalListeners = new Set<(code: string) => void>();
  private readonly unsubscribeEvent: () => void;
  private readonly unsubscribeFailure: () => void;
  private runtimeLease: ParakeetRuntimeLease | null;
  private runtimeLeasePromise: Promise<ParakeetRuntimeLease> | null = null;
  private nextId = 0;
  private closed = false;
  private terminalCode: string | null = null;

  constructor(
    private readonly options: {
      process?: NativeJsonLineTransport;
      runtimeHost?: ParakeetRuntimeHost;
      runtimeLease?: ParakeetRuntimeLease;
      maxOutstandingPerSource: number;
    },
  ) {
    if (
      (!options.process && !options.runtimeHost) ||
      !Number.isSafeInteger(options.maxOutstandingPerSource) ||
      options.maxOutstandingPerSource < 1 ||
      (options.runtimeLease && options.runtimeLease.kind !== 'live')
    ) {
      throw new Error('parakeet_request_invalid');
    }
    this.process = options.process ?? options.runtimeHost!.transport;
    this.runtimeLease = options.runtimeLease ?? null;
    this.unsubscribeEvent = this.process.onEvent((event) =>
      this.consumeEvent(event),
    );
    this.unsubscribeFailure = this.process.onFailure((code) =>
      this.failAll(code, false),
    );
  }

  onUpdate(listener: (event: NativeEouUpdateEvent) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  onTerminalFailure(listener: (code: string) => void): () => void {
    this.terminalListeners.add(listener);
    return () => this.terminalListeners.delete(listener);
  }

  async open(identity: ParakeetEouIdentity): Promise<void> {
    this.requireUsable();
    this.validateIdentity(identity);
    if (
      this.streams.has(identity.streamId) ||
      this.sourceStreams.has(identity.source) ||
      this.streams.size >= 2
    ) {
      throw new Error('parakeet_stream_capacity');
    }
    const state: StreamState = {
      ...identity,
      nextSequence: 1,
      nextRevision: 1,
      queue: [],
      inFlight: null,
      drainWaiters: [],
      closing: false,
    };
    this.streams.set(identity.streamId, state);
    this.sourceStreams.set(identity.source, identity.streamId);
    try {
      await this.ensureRuntimeLease();
      await this.send('eou_open', identity);
    } catch (error) {
      console.warn(
        `[ParakeetEOU] open failed source=${identity.source} code=${this.errorCode(error)}`,
      );
      this.remove(state);
      await this.releaseRuntimeLeaseIfIdle();
      throw error;
    }
  }

  append(request: EouPcmAppend): Promise<void> {
    try {
      this.requireUsable();
      const state = this.requireState(request);
      if (state.closing) throw new Error('parakeet_stream_closed');
      if (request.sequence !== state.nextSequence) {
        throw new Error('parakeet_sequence_out_of_order');
      }
      if (
        state.queue.length + (state.inFlight ? 1 : 0) >=
        this.options.maxOutstandingPerSource
      ) {
        throw new Error('parakeet_backpressure');
      }
      const encoded = encodeEouPcmAppend(request);
      state.nextSequence += 1;
      const operation = new Promise<void>((resolve, reject) => {
        state.queue.push({
          request: { ...request, samples: request.samples },
          resolve,
          reject,
        });
      });
      this.pump(state, encoded);
      return operation;
    } catch (error) {
      return Promise.reject(this.asError(error));
    }
  }

  async finish(identity: ParakeetEouIdentity): Promise<void> {
    this.requireUsable();
    const state = this.requireState(identity);
    if (state.closing) throw new Error('parakeet_stream_closed');
    state.closing = true;
    try {
      await this.waitForDrain(state);
      await this.send('eou_finish', identity);
      this.remove(state);
      await this.releaseRuntimeLeaseIfIdle();
    } catch (error) {
      this.failAll(this.errorCode(error), true);
      throw error;
    }
  }

  async cancel(identity: ParakeetEouIdentity): Promise<void> {
    const state = this.requireState(identity);
    await this.cancelState(state);
    await this.releaseRuntimeLeaseIfIdle();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      [...this.streams.values()].map((state) => this.cancelState(state)),
    );
    await this.releaseRuntimeLeaseIfIdle(true);
    this.unsubscribeEvent();
    this.unsubscribeFailure();
  }

  private pump(
    state: StreamState,
    firstEncoded?: Record<string, unknown>,
  ): void {
    if (state.inFlight) return;
    const job = state.queue.shift();
    if (!job) {
      this.resolveDrain(state);
      return;
    }
    state.inFlight = job;
    let encoded: Record<string, unknown>;
    try {
      encoded = firstEncoded ?? encodeEouPcmAppend(job.request);
    } catch (error) {
      state.inFlight = null;
      job.reject(this.asError(error));
      this.failAll(this.errorCode(error), true);
      return;
    }
    void this.send('eou_append', encoded).then(
      () => {
        if (state.inFlight !== job) return;
        state.inFlight = null;
        job.resolve();
        this.pump(state);
      },
      (error: unknown) => {
        if (state.inFlight !== job) return;
        state.inFlight = null;
        job.reject(this.asError(error));
        this.failAll(this.errorCode(error), true);
      },
    );
  }

  private consumeEvent(event: NativeEvent): void {
    if (event.event !== 'eou_update' && event.event !== 'eou_failed') return;
    const state = this.streams.get(event.streamId);
    if (!state) return;
    if (
      event.source !== state.source ||
      event.generation !== state.generation
    ) {
      this.failAll('parakeet_event_stale', true);
      return;
    }
    if (event.revision !== state.nextRevision) {
      this.failAll('parakeet_event_out_of_order', true);
      return;
    }
    state.nextRevision += 1;
    if (event.event === 'eou_failed') {
      console.warn(
        `[ParakeetEOU] native failure source=${event.source} reason=${event.reason}`,
      );
      this.failAll(`parakeet_${event.reason}`, true);
      return;
    }
    for (const listener of this.updateListeners) listener(event);
  }

  private failAll(code: string, cancelNative: boolean): void {
    if (this.terminalCode) return;
    this.terminalCode = code;
    const states = [...this.streams.values()];
    const error = new Error(code);
    for (const state of states) {
      if (state.inFlight) state.inFlight.reject(error);
      state.inFlight = null;
      for (const queued of state.queue.splice(0)) queued.reject(error);
      for (const waiter of state.drainWaiters.splice(0)) waiter.reject(error);
    }
    if (cancelNative) {
      void Promise.all(states.map((state) => this.cancelState(state))).finally(
        () => this.releaseRuntimeLeaseIfIdle(true),
      );
    } else {
      for (const state of states) this.remove(state);
      void this.releaseRuntimeLeaseIfIdle(true);
    }
    for (const listener of this.terminalListeners) listener(code);
  }

  private async cancelState(state: StreamState): Promise<void> {
    if (!this.streams.has(state.streamId)) return;
    this.remove(state);
    try {
      await this.send('eou_cancel', {
        streamId: state.streamId,
        source: state.source,
        generation: state.generation,
      });
    } catch {
      // Cleanup is best-effort after the visible session has already been fenced.
    }
  }

  private waitForDrain(state: StreamState): Promise<void> {
    if (!state.inFlight && state.queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      state.drainWaiters.push({ resolve, reject });
    });
  }

  private resolveDrain(state: StreamState): void {
    if (state.inFlight || state.queue.length > 0) return;
    for (const waiter of state.drainWaiters.splice(0)) waiter.resolve();
  }

  private remove(state: StreamState): void {
    if (this.streams.get(state.streamId) === state) {
      this.streams.delete(state.streamId);
      this.sourceStreams.delete(state.source);
    }
  }

  private requireState(identity: ParakeetEouIdentity): StreamState {
    const state = this.streams.get(identity.streamId);
    if (
      !state ||
      state.source !== identity.source ||
      state.generation !== identity.generation
    ) {
      throw new Error('parakeet_stream_not_found');
    }
    return state;
  }

  private validateIdentity(identity: ParakeetEouIdentity): void {
    if (
      !STREAM_ID_PATTERN.test(identity.streamId) ||
      identity.streamId.includes('..') ||
      (identity.source !== 'mic' && identity.source !== 'system') ||
      !Number.isSafeInteger(identity.generation) ||
      identity.generation <= 0
    ) {
      throw new Error('parakeet_request_invalid');
    }
  }

  private requireUsable(): void {
    if (this.closed) throw new Error('parakeet_client_closed');
    if (this.terminalCode) throw new Error(this.terminalCode);
  }

  private async ensureRuntimeLease(): Promise<void> {
    if (this.runtimeLease || !this.options.runtimeHost) return;
    this.runtimeLeasePromise ??= this.options.runtimeHost.acquire('live');
    this.runtimeLease = await this.runtimeLeasePromise;
    this.runtimeLeasePromise = null;
  }

  private async releaseRuntimeLeaseIfIdle(force = false): Promise<void> {
    if ((!force && this.streams.size > 0) || !this.runtimeLease) return;
    const lease = this.runtimeLease;
    this.runtimeLease = null;
    await lease.release();
  }

  private async send(
    method: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.process.request({
      schemaVersion: 1,
      id: `eou-${method}-${++this.nextId}`,
      method,
      ...fields,
    });
    this.requireEmptySuccess(response);
  }

  private requireEmptySuccess(response: NativeResponse): void {
    if (!response.ok) {
      throw new Error(response.error?.code ?? 'parakeet_native_failed');
    }
    if (!response.result || Object.keys(response.result).length !== 0) {
      throw new Error('parakeet_protocol_invalid');
    }
  }

  private errorCode(error: unknown): string {
    return this.asError(error).message || 'parakeet_native_failed';
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('parakeet_native_failed');
  }
}
