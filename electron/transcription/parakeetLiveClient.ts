import type {
  NativeEvent,
  NativeJsonLineTransport,
  NativeLiveSource,
  NativeResponse,
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

type StreamState = ParakeetLiveIdentity & {
  nextSequence: number;
  nextRevision: number;
  pendingAppends: number;
  tail: Promise<void>;
  active: boolean;
  closing: boolean;
};

const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export class ParakeetLiveClient {
  private readonly streams = new Map<string, StreamState>();
  private readonly sourceStreams = new Map<NativeLiveSource, string>();
  private readonly eventListeners = new Set<(event: NativeEvent) => void>();
  private readonly protocolErrorListeners = new Set<(code: string) => void>();
  private readonly unsubscribe: () => void;
  private nextID = 0;

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
    this.unsubscribe = options.process.onEvent((event) =>
      this.consumeEvent(event),
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
    this.validateIdentity(identity);
    if (
      this.streams.size >= 2 ||
      this.streams.has(identity.streamId) ||
      this.sourceStreams.has(identity.source)
    ) {
      throw new Error('parakeet_stream_capacity');
    }
    const state: StreamState = {
      ...identity,
      nextSequence: 1,
      nextRevision: 1,
      pendingAppends: 0,
      tail: Promise.resolve(),
      active: true,
      closing: false,
    };
    this.streams.set(identity.streamId, state);
    this.sourceStreams.set(identity.source, identity.streamId);
    try {
      await this.send('stream_open', identity, signal);
    } catch (error) {
      this.remove(state);
      throw error;
    }
  }

  append(request: ParakeetLiveAppend): Promise<void> {
    let state: StreamState;
    try {
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
    if (state.pendingAppends > this.options.maxQueuedAppends) {
      return Promise.reject(new Error('parakeet_backpressure'));
    }

    state.nextSequence += 1;
    state.pendingAppends += 1;
    const previous = state.tail;
    const queuedOperation = previous
      .then(async () => {
        if (!state.active || request.signal?.aborted) {
          throw new Error('parakeet_cancelled');
        }
        await this.send('stream_append', request, request.signal);
      })
      .catch((error: unknown) => {
        state.active = false;
        this.remove(state);
        throw error;
      });
    const operation = request.signal
      ? this.rejectQueuedAbort(queuedOperation, request.signal)
      : queuedOperation;
    state.tail = operation;
    void operation
      .finally(() => {
        state.pendingAppends -= 1;
      })
      .catch(() => undefined);
    return operation;
  }

  private rejectQueuedAbort(
    operation: Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('parakeet_cancelled'));
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('parakeet_cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      operation.then(
        () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  async flush(
    identity: ParakeetLiveIdentity,
    signal?: AbortSignal,
  ): Promise<void> {
    const state = this.requireState(identity);
    if (state.closing) throw new Error('parakeet_stream_closed');
    state.closing = true;
    await state.tail;
    if (!state.active) throw new Error('parakeet_cancelled');
    await this.send('stream_flush', identity, signal);
    this.remove(state);
  }

  async cancel(
    identity: ParakeetLiveIdentity,
    signal?: AbortSignal,
  ): Promise<void> {
    const state = this.requireState(identity);
    state.active = false;
    state.closing = true;
    this.remove(state);
    await this.send('stream_cancel', identity, signal);
  }

  async reset(
    identity: ParakeetLiveIdentity,
    signal?: AbortSignal,
  ): Promise<void> {
    const state = this.requireState(identity);
    state.active = false;
    state.closing = true;
    this.remove(state);
    await this.send('stream_reset', identity, signal);
  }

  close(): void {
    for (const state of this.streams.values()) state.active = false;
    this.streams.clear();
    this.sourceStreams.clear();
    this.unsubscribe();
    this.options.process.terminate();
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
      state.active = false;
      this.remove(state);
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

  private remove(state: StreamState): void {
    if (this.streams.get(state.streamId) === state)
      this.streams.delete(state.streamId);
    if (this.sourceStreams.get(state.source) === state.streamId) {
      this.sourceStreams.delete(state.source);
    }
  }

  private requestID(method: string): string {
    this.nextID += 1;
    return `${method}-${this.nextID}`;
  }
}
