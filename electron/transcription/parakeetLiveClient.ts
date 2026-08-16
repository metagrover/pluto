import type {
  NativeEvent,
  NativeJsonLineTransport,
  NativeLiveSource,
  NativeResponse,
  NativeStreamDegradedEvent,
} from './nativeJsonLineProcess';

export type ParakeetLiveIdentity = {
  streamId: string;
  source: NativeLiveSource;
  generation: number;
};

export type ParakeetLiveAppend = ParakeetLiveIdentity & {
  sequence: number;
  audioPath: string;
  chunkStartSeconds: number;
  chunkEndSeconds: number;
  signal?: AbortSignal;
};

export type ParakeetLiveDegradation = Omit<
  NativeStreamDegradedEvent,
  'schemaVersion' | 'kind' | 'event'
>;

export type ParakeetLiveFlushResult = {
  finalPreview: string;
  degradations: ParakeetLiveDegradation[];
};

type AppendJob = {
  request: ParakeetLiveAppend;
  resolve: () => void;
  reject: (error: Error) => void;
  removeAbort?: () => void;
};

type DrainWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type StreamState = ParakeetLiveIdentity & {
  nextSequence: number;
  nextRevision: number;
  queue: AppendJob[];
  inFlight: AppendJob | null;
  inFlightController: AbortController | null;
  drainWaiters: DrainWaiter[];
  active: boolean;
  closing: boolean;
  resetGenerationInFlight: number | null;
  terminalPromise: Promise<void> | null;
};

const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const NONTERMINAL_NATIVE_ERRORS = new Set([
  'parakeet_path_not_allowed',
  'parakeet_path_missing',
]);

export class ParakeetLiveClient {
  private readonly streams = new Map<string, StreamState>();
  private readonly sourceStreams = new Map<NativeLiveSource, string>();
  private readonly eventListeners = new Set<(event: NativeEvent) => void>();
  private readonly protocolErrorListeners = new Set<(code: string) => void>();
  private readonly unsubscribeEvent: () => void;
  private readonly unsubscribeFailure: () => void;
  private nextID = 0;
  private closed = false;

  constructor(
    private readonly options: {
      process: NativeJsonLineTransport;
      maxQueuedAppends: number;
    },
  ) {
    if (
      !Number.isSafeInteger(options.maxQueuedAppends) ||
      options.maxQueuedAppends < 0
    ) {
      throw new Error('parakeet_request_invalid');
    }
    this.unsubscribeEvent = options.process.onEvent((event) =>
      this.consumeEvent(event),
    );
    this.unsubscribeFailure = options.process.onFailure((code) =>
      this.invalidateAll(code),
    );
  }

  onEvent(listener: (event: NativeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onProtocolError(listener: (code: string) => void): () => void {
    this.protocolErrorListeners.add(listener);
    return () => this.protocolErrorListeners.delete(listener);
  }

  async open(
    identity: ParakeetLiveIdentity,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireOpenClient();
    this.validateIdentity(identity);
    if (
      this.streams.size >= 2 ||
      this.streams.has(identity.streamId) ||
      this.sourceStreams.has(identity.source)
    ) {
      throw new Error('parakeet_stream_capacity');
    }
    const state = this.makeState(identity);
    this.streams.set(identity.streamId, state);
    this.sourceStreams.set(identity.source, identity.streamId);
    try {
      await this.send('stream_open', identity, signal);
      if (!state.active) throw new Error('parakeet_process_exited');
    } catch (error) {
      if (state.active && !this.isNonterminal(error)) {
        await this.terminateState(state, this.errorCode(error));
      } else {
        this.remove(state);
      }
      throw error;
    }
  }

  append(request: ParakeetLiveAppend): Promise<void> {
    let state: StreamState;
    try {
      this.requireOpenClient();
      this.validateAppend(request);
      state = this.requireState(request);
    } catch (error) {
      return Promise.reject(error);
    }
    if (state.closing)
      return Promise.reject(new Error('parakeet_stream_closed'));
    if (request.sequence !== state.nextSequence) {
      return Promise.reject(new Error('parakeet_sequence_out_of_order'));
    }
    const outstanding = state.queue.length + (state.inFlight ? 1 : 0);
    if (outstanding > this.options.maxQueuedAppends) {
      return Promise.reject(new Error('parakeet_backpressure'));
    }

    state.nextSequence += 1;
    const operation = new Promise<void>((resolve, reject) => {
      const job: AppendJob = { request, resolve, reject };
      if (request.signal) {
        const abort = () => {
          void this.terminateState(state, 'parakeet_cancelled');
        };
        request.signal.addEventListener('abort', abort, { once: true });
        job.removeAbort = () =>
          request.signal?.removeEventListener('abort', abort);
      }
      state.queue.push(job);
    });
    if (request.signal?.aborted) {
      void this.terminateState(state, 'parakeet_cancelled');
    } else {
      this.pump(state);
    }
    return operation;
  }

  async flush(
    identity: ParakeetLiveIdentity,
    signal?: AbortSignal,
  ): Promise<ParakeetLiveFlushResult> {
    this.requireOpenClient();
    const state = this.requireState(identity);
    if (state.closing) throw new Error('parakeet_stream_closed');
    state.closing = true;
    try {
      await this.waitForDrain(state);
      if (!state.active) throw new Error('parakeet_cancelled');
      const result = await this.send('stream_flush', identity, signal);
      const parsed = this.parseFlushResult(result, state);
      this.remove(state);
      state.active = false;
      return parsed;
    } catch (error) {
      if (state.active && this.isNonterminal(error)) {
        state.closing = false;
      } else if (state.active) {
        await this.terminateState(state, this.errorCode(error));
      }
      throw error;
    }
  }

  async cancel(
    identity: ParakeetLiveIdentity,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.requireOpenClient();
    const state = this.requireState(identity);
    await this.terminateState(state, 'parakeet_cancelled');
  }

  async reset(
    identity: ParakeetLiveIdentity,
    nextGeneration: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireOpenClient();
    const state = this.requireState(identity);
    if (
      !Number.isSafeInteger(nextGeneration) ||
      nextGeneration !== state.generation + 1
    ) {
      throw new Error('parakeet_generation_mismatch');
    }
    if (state.closing) throw new Error('parakeet_stream_closed');
    state.closing = true;
    try {
      await this.waitForDrain(state);
      state.resetGenerationInFlight = nextGeneration;
      await this.send(
        'stream_reset',
        { ...identity, generation: nextGeneration },
        signal,
      );
      state.generation = nextGeneration;
      state.resetGenerationInFlight = null;
      state.nextSequence = 1;
      state.nextRevision = 1;
      state.closing = false;
    } catch (error) {
      if (state.active && this.isNonterminal(error)) {
        state.resetGenerationInFlight = null;
        state.closing = false;
      } else if (state.active) {
        await this.terminateState(state, this.errorCode(error));
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invalidateAll('parakeet_process_terminated');
    this.options.process.terminate();
    this.unsubscribeEvent();
    this.unsubscribeFailure();
  }

  private pump(state: StreamState): void {
    if (!state.active || state.inFlight || state.terminalPromise) return;
    const job = state.queue.shift();
    if (!job) {
      this.resolveDrain(state);
      return;
    }
    state.inFlight = job;
    const controller = new AbortController();
    state.inFlightController = controller;
    void this.send('stream_append', job.request, controller.signal).then(
      () => {
        if (!state.active || state.inFlight !== job) return;
        this.finishJob(state, job);
        job.resolve();
        this.pump(state);
      },
      async (error: unknown) => {
        if (!state.active) return;
        if (this.isNonterminal(error)) {
          this.finishJob(state, job);
          job.reject(this.asError(error));
          for (const queued of state.queue.splice(0)) {
            queued.removeAbort?.();
            queued.reject(new Error('parakeet_predecessor_failed'));
          }
          state.nextSequence = job.request.sequence;
          state.closing = false;
          this.rejectDrain(state, this.asError(error));
          return;
        }
        await this.terminateState(state, this.errorCode(error));
      },
    );
  }

  private finishJob(state: StreamState, job: AppendJob): void {
    job.removeAbort?.();
    if (state.inFlight === job) {
      state.inFlight = null;
      state.inFlightController = null;
    }
  }

  private terminateState(state: StreamState, code: string): Promise<void> {
    if (state.terminalPromise) return state.terminalPromise;
    state.active = false;
    state.closing = true;
    state.inFlightController?.abort();
    const cancellationGenerations =
      state.resetGenerationInFlight === null ||
      state.resetGenerationInFlight === state.generation
        ? [state.generation]
        : [state.resetGenerationInFlight, state.generation];
    state.terminalPromise = (async () => {
      if (!this.isTransportFailure(code) && !this.closed) {
        for (const [index, generation] of cancellationGenerations.entries()) {
          try {
            await this.send('stream_cancel', {
              streamId: state.streamId,
              source: state.source,
              generation,
            });
            break;
          } catch (error) {
            const canTryPreviousGeneration =
              index === 0 &&
              cancellationGenerations.length === 2 &&
              this.errorCode(error) === 'parakeet_request_invalid';
            if (!canTryPreviousGeneration) break;
          }
        }
      }
      this.remove(state);
      const error = new Error(code);
      if (state.inFlight) {
        state.inFlight.removeAbort?.();
        state.inFlight.reject(error);
        state.inFlight = null;
      }
      state.inFlightController = null;
      for (const queued of state.queue.splice(0)) {
        queued.removeAbort?.();
        queued.reject(error);
      }
      this.rejectDrain(state, error);
    })();
    return state.terminalPromise;
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

  private rejectDrain(state: StreamState, error: Error): void {
    for (const waiter of state.drainWaiters.splice(0)) waiter.reject(error);
  }

  private async send(
    method: string,
    fields: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new Error('parakeet_cancelled');
    const id = this.requestID(method);
    const request = this.options.process.request({
      schemaVersion: 1,
      id,
      method,
      ...fields,
      signal: undefined,
    });
    const response = signal
      ? await this.withAbort(request, id, signal)
      : await request;
    return this.requireSuccess(response);
  }

  private withAbort(
    request: Promise<NativeResponse>,
    id: string,
    signal: AbortSignal,
  ): Promise<NativeResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        const cancelID = this.requestID('cancel');
        this.options.process.ignoreResponse(cancelID);
        this.options.process.notify({
          schemaVersion: 1,
          id: cancelID,
          method: 'cancel',
          targetId: id,
        });
        this.options.process.cancelPending(id);
        reject(new Error('parakeet_cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
      request.then(
        (response) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          resolve(response);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  private requireSuccess(response: NativeResponse): Record<string, unknown> {
    if (!response.ok)
      throw new Error(response.error?.code ?? 'parakeet_native_failed');
    if (!response.result) throw new Error('parakeet_protocol_invalid');
    return response.result;
  }

  private parseFlushResult(
    result: Record<string, unknown>,
    state: StreamState,
  ): ParakeetLiveFlushResult {
    if (
      Object.keys(result).some(
        (key) => key !== 'finalPreview' && key !== 'degradations',
      ) ||
      typeof result.finalPreview !== 'string' ||
      !Array.isArray(result.degradations)
    ) {
      throw new Error('parakeet_protocol_invalid');
    }
    const degradations = result.degradations.map((value) =>
      this.parseDegradation(value, state),
    );
    return { finalPreview: result.finalPreview, degradations };
  }

  private parseDegradation(
    value: unknown,
    state: StreamState,
  ): ParakeetLiveDegradation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('parakeet_protocol_invalid');
    }
    const candidate = value as ParakeetLiveDegradation;
    const allowed = new Set([
      'streamId',
      'source',
      'generation',
      'revision',
      'reason',
      'affectedSequence',
      'chunkStartSeconds',
      'chunkEndSeconds',
    ]);
    const reasons = new Set([
      'backpressure',
      'sequence_gap',
      'partial_window',
      'coverage_gap',
      'thermal_pressure',
    ]);
    const hasStart = candidate.chunkStartSeconds !== undefined;
    const hasEnd = candidate.chunkEndSeconds !== undefined;
    if (
      Object.keys(value).some((key) => !allowed.has(key)) ||
      candidate.streamId !== state.streamId ||
      candidate.source !== state.source ||
      candidate.generation !== state.generation ||
      !Number.isSafeInteger(candidate.revision) ||
      candidate.revision <= 0 ||
      typeof candidate.reason !== 'string' ||
      !reasons.has(candidate.reason) ||
      (candidate.affectedSequence !== undefined &&
        (!Number.isSafeInteger(candidate.affectedSequence) ||
          candidate.affectedSequence <= 0)) ||
      hasStart !== hasEnd ||
      (hasStart &&
        (!Number.isFinite(candidate.chunkStartSeconds) ||
          !Number.isFinite(candidate.chunkEndSeconds) ||
          (candidate.chunkStartSeconds ?? -1) < 0 ||
          (candidate.chunkEndSeconds ?? -1) <=
            (candidate.chunkStartSeconds ?? 0)))
    ) {
      throw new Error('parakeet_protocol_invalid');
    }
    return candidate;
  }

  private consumeEvent(event: NativeEvent): void {
    const state = this.streams.get(event.streamId);
    if (!state || !state.active) return;
    if (
      event.source !== state.source ||
      event.generation !== state.generation
    ) {
      this.reportProtocolError('parakeet_event_stale');
      return;
    }
    if (event.revision !== state.nextRevision) {
      this.reportProtocolError('parakeet_event_out_of_order');
      return;
    }
    state.nextRevision += 1;
    for (const listener of this.eventListeners) listener(event);
    if (event.event === 'stream_failed') {
      void this.terminateState(state, `parakeet_${event.reason}`);
    }
  }

  private invalidateAll(code: string): void {
    for (const state of [...this.streams.values()]) {
      state.active = false;
      this.remove(state);
      const error = new Error(code);
      if (state.inFlight) {
        state.inFlight.removeAbort?.();
        state.inFlight.reject(error);
        state.inFlight = null;
      }
      for (const queued of state.queue.splice(0)) {
        queued.removeAbort?.();
        queued.reject(error);
      }
      this.rejectDrain(state, error);
    }
  }

  private reportProtocolError(code: string): void {
    for (const listener of this.protocolErrorListeners) listener(code);
  }

  private requireState(identity: ParakeetLiveIdentity): StreamState {
    this.validateIdentity(identity);
    const state = this.streams.get(identity.streamId);
    if (!state || !state.active) throw new Error('parakeet_stream_not_found');
    if (
      state.source !== identity.source ||
      state.generation !== identity.generation
    ) {
      throw new Error('parakeet_stream_mismatch');
    }
    return state;
  }

  private validateAppend(request: ParakeetLiveAppend): void {
    this.validateIdentity(request);
    if (
      !Number.isSafeInteger(request.sequence) ||
      request.sequence <= 0 ||
      typeof request.audioPath !== 'string' ||
      request.audioPath.length === 0 ||
      !Number.isFinite(request.chunkStartSeconds) ||
      !Number.isFinite(request.chunkEndSeconds) ||
      request.chunkStartSeconds < 0 ||
      request.chunkEndSeconds <= request.chunkStartSeconds
    ) {
      throw new Error('parakeet_request_invalid');
    }
  }

  private validateIdentity(identity: ParakeetLiveIdentity): void {
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

  private makeState(identity: ParakeetLiveIdentity): StreamState {
    return {
      ...identity,
      nextSequence: 1,
      nextRevision: 1,
      queue: [],
      inFlight: null,
      inFlightController: null,
      drainWaiters: [],
      active: true,
      closing: false,
      resetGenerationInFlight: null,
      terminalPromise: null,
    };
  }

  private remove(state: StreamState): void {
    if (this.streams.get(state.streamId) === state)
      this.streams.delete(state.streamId);
    if (this.sourceStreams.get(state.source) === state.streamId) {
      this.sourceStreams.delete(state.source);
    }
  }

  private requireOpenClient(): void {
    if (this.closed) throw new Error('parakeet_client_closed');
  }

  private isNonterminal(error: unknown): boolean {
    return NONTERMINAL_NATIVE_ERRORS.has(this.errorCode(error));
  }

  private isTransportFailure(code: string): boolean {
    return (
      code.startsWith('parakeet_process_') ||
      code === 'parakeet_protocol_invalid'
    );
  }

  private errorCode(error: unknown): string {
    return error instanceof Error && error.message.startsWith('parakeet_')
      ? error.message
      : 'parakeet_native_failed';
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('parakeet_native_failed');
  }

  private requestID(method: string): string {
    this.nextID += 1;
    return `${method}-${this.nextID}`;
  }
}
