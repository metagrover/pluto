import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export type NativeChildProcess = Pick<ChildProcess, 'on' | 'once' | 'kill'> & {
  stdin: Pick<Writable, 'write' | 'end'>;
  stdout: Pick<Readable, 'on'>;
  stderr: Pick<Readable, 'on'>;
};

export type NativeProcessSpawn = (
  executablePath: string,
  args: string[],
  options: SpawnOptions,
) => NativeChildProcess;

type PendingRequest = {
  resolve: (response: NativeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type NativeFailureCode =
  | 'parakeet_request_invalid'
  | 'parakeet_path_not_allowed'
  | 'parakeet_path_missing'
  | 'parakeet_model_preparation_failed'
  | 'parakeet_transcription_failed'
  | 'parakeet_cancelled';

export type NativeResponse = {
  schemaVersion: 1;
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: NativeFailureCode };
};

export type NativeLiveSource = 'mic' | 'system';

type NativeEventIdentity = {
  schemaVersion: 1;
  kind: 'event';
  streamId: string;
  source: NativeLiveSource;
  generation: number;
  revision: number;
};

export type NativeStreamUpdateEvent = NativeEventIdentity & {
  event: 'stream_update';
  qualifiesPriorTentative: boolean;
  committedThroughSequence: number;
  tentativeThroughSequence: number;
  text: string;
  confidence: number;
  audioEndSeconds: number;
};

export type NativeStreamDegradedEvent = NativeEventIdentity & {
  event: 'stream_degraded';
  reason:
    | 'backpressure'
    | 'sequence_gap'
    | 'partial_window'
    | 'coverage_gap'
    | 'thermal_pressure';
  affectedSequence?: number;
  chunkStartSeconds?: number;
  chunkEndSeconds?: number;
};

export type NativeStreamFailedEvent = NativeEventIdentity & {
  event: 'stream_failed';
  reason:
    | 'invalid_request'
    | 'stream_not_found'
    | 'generation_mismatch'
    | 'sequence_out_of_order'
    | 'path_not_allowed'
    | 'audio_decode_failed'
    | 'model_unavailable'
    | 'inference_failed'
    | 'cancelled';
};

export type NativeEouToken = {
  text: string;
  startSeconds: number;
  endSeconds: number;
  committed: boolean;
};

export type NativeEouUpdateEvent = NativeEventIdentity & {
  event: 'eou_update';
  processedAudioSeconds: number;
  committedText: string;
  tentativeText: string;
  tokens: NativeEouToken[];
};

export type NativeEouFailedEvent = NativeEventIdentity & {
  event: 'eou_failed';
  reason:
    | 'invalid_request'
    | 'stream_not_found'
    | 'generation_mismatch'
    | 'source_mismatch'
    | 'sequence_out_of_order'
    | 'backpressure'
    | 'audio_decode_failed'
    | 'model_unavailable'
    | 'inference_failed'
    | 'prefix_mutated'
    | 'cancelled';
};

export type NativeEvent =
  | NativeStreamUpdateEvent
  | NativeStreamDegradedEvent
  | NativeStreamFailedEvent
  | NativeEouUpdateEvent
  | NativeEouFailedEvent;

export interface NativeJsonLineTransport {
  request(payload: Record<string, unknown>): Promise<NativeResponse>;
  notify(payload: Record<string, unknown>): void;
  onEvent(listener: (event: NativeEvent) => void): () => void;
  onFailure(listener: (code: string) => void): () => void;
  cancelPending(id: string): void;
  ignoreResponse(id: string): void;
}

const MAX_BUFFER_BYTES = 1024 * 1024;

export class NativeJsonLineProcess {
  private child: NativeChildProcess | null = null;
  private stdoutBuffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly ignoredResponseIDs = new Set<string>();
  private readonly eventListeners = new Set<(event: NativeEvent) => void>();
  private readonly failureListeners = new Set<(code: string) => void>();

  constructor(
    private readonly options: {
      executablePath: string | (() => string);
      args: string[];
      spawn: NativeProcessSpawn;
      requestTimeoutMs: number;
      diagnostic?: (code: string) => void;
    },
  ) {}

  start(): void {
    if (this.child) return;
    const child = this.options.spawn(
      typeof this.options.executablePath === 'function'
        ? this.options.executablePath()
        : this.options.executablePath,
      this.options.args,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;
    child.stdout.on('data', (chunk: Buffer | string) => {
      if (this.child === child) this.consumeStdout(chunk.toString());
    });
    child.stderr.on('data', () => {
      if (this.child === child)
        this.options.diagnostic?.('parakeet_stderr_activity');
    });
    child.once('error', () => this.failChild(child, 'parakeet_process_error'));
    child.once('exit', () => this.failChild(child, 'parakeet_process_exited'));
  }

  request(payload: Record<string, unknown>): Promise<NativeResponse> {
    this.start();
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!id || this.pending.has(id)) {
      return Promise.reject(new Error('parakeet_request_invalid'));
    }
    const child = this.child;
    if (!child) return Promise.reject(new Error('parakeet_process_error'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failChild(child, 'parakeet_request_timeout');
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch {
        this.failChild(child, 'parakeet_process_write_failed');
      }
    });
  }

  notify(payload: Record<string, unknown>): void {
    this.start();
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      this.failChild(child, 'parakeet_process_write_failed');
    }
  }

  onEvent(listener: (event: NativeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onFailure(listener: (code: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  cancelPending(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.ignoredResponseIDs.add(id);
    pending.reject(new Error('parakeet_cancelled'));
  }

  ignoreResponse(id: string): void {
    this.ignoredResponseIDs.add(id);
  }

  terminate(): void {
    const child = this.child;
    if (child) this.failChild(child, 'parakeet_process_terminated');
  }

  private stopChild(child: NativeChildProcess): void {
    if (this.child !== child) return;
    this.child = null;
    this.stdoutBuffer = '';
    child.stdin.end();
    child.kill('SIGTERM');
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_BUFFER_BYTES) {
        this.failCurrent('parakeet_protocol_invalid');
        return;
      }
      if (line.length > 0) this.consumeLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_BUFFER_BYTES) {
      this.failCurrent('parakeet_protocol_invalid');
    }
  }

  private consumeLine(line: string): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(line);
    } catch {
      this.failCurrent('parakeet_protocol_invalid');
      return;
    }
    if (isRecord(envelope) && envelope.kind === 'event') {
      const event = parseNativeEvent(envelope);
      if (!event) {
        this.failCurrent('parakeet_protocol_invalid');
        return;
      }
      for (const listener of this.eventListeners) {
        try {
          listener(event);
        } catch {
          this.options.diagnostic?.('parakeet_event_listener_failed');
        }
      }
      return;
    }
    const response = parseNativeResponse(envelope);
    if (!response) {
      this.failCurrent('parakeet_protocol_invalid');
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      if (this.ignoredResponseIDs.delete(response.id)) return;
      this.failCurrent('parakeet_protocol_invalid');
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private failCurrent(code: string): void {
    const child = this.child;
    if (child) this.failChild(child, code);
  }

  private failChild(child: NativeChildProcess, code: string): void {
    if (this.child !== child) return;
    const requests = [...this.pending.values()];
    this.pending.clear();
    this.ignoredResponseIDs.clear();
    this.stopChild(child);
    for (const request of requests) {
      clearTimeout(request.timer);
      request.reject(new Error(code));
    }
    for (const listener of this.failureListeners) {
      try {
        listener(code);
      } catch {
        this.options.diagnostic?.('parakeet_failure_listener_failed');
      }
    }
  }
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_SAFE_INTEGER
  );
}

const NATIVE_FAILURE_CODES = new Set<NativeFailureCode>([
  'parakeet_request_invalid',
  'parakeet_path_not_allowed',
  'parakeet_path_missing',
  'parakeet_model_preparation_failed',
  'parakeet_transcription_failed',
  'parakeet_cancelled',
]);

function parseNativeResponse(value: unknown): NativeResponse | null {
  if (!isRecord(value)) return null;
  const common = ['schemaVersion', 'id', 'ok'] as const;
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.ok !== 'boolean'
  ) {
    return null;
  }
  if (value.ok) {
    if (!hasOnlyKeys(value, [...common, 'result']) || !isRecord(value.result)) {
      return null;
    }
  } else {
    if (
      !hasOnlyKeys(value, [...common, 'error']) ||
      !isRecord(value.error) ||
      !hasOnlyKeys(value.error, ['code']) ||
      typeof value.error.code !== 'string' ||
      !NATIVE_FAILURE_CODES.has(value.error.code as NativeFailureCode)
    ) {
      return null;
    }
  }
  return value as NativeResponse;
}

function hasValidIdentity(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 1 &&
    value.kind === 'event' &&
    typeof value.streamId === 'string' &&
    STREAM_ID_PATTERN.test(value.streamId) &&
    !value.streamId.includes('..') &&
    (value.source === 'mic' || value.source === 'system') &&
    isPositiveSafeInteger(value.generation) &&
    isPositiveSafeInteger(value.revision)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function parseNativeEvent(value: Record<string, unknown>): NativeEvent | null {
  if (!hasValidIdentity(value)) return null;
  const identityKeys = [
    'schemaVersion',
    'kind',
    'event',
    'streamId',
    'source',
    'generation',
    'revision',
  ] as const;

  if (value.event === 'stream_update') {
    if (
      !hasOnlyKeys(value, [
        ...identityKeys,
        'qualifiesPriorTentative',
        'committedThroughSequence',
        'tentativeThroughSequence',
        'text',
        'confidence',
        'audioEndSeconds',
      ]) ||
      typeof value.qualifiesPriorTentative !== 'boolean' ||
      !isNonnegativeSafeInteger(value.committedThroughSequence) ||
      !isNonnegativeSafeInteger(value.tentativeThroughSequence) ||
      value.committedThroughSequence > value.tentativeThroughSequence ||
      typeof value.text !== 'string' ||
      typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1 ||
      typeof value.audioEndSeconds !== 'number' ||
      !Number.isFinite(value.audioEndSeconds) ||
      value.audioEndSeconds < 0
    ) {
      return null;
    }
    return value as NativeStreamUpdateEvent;
  }

  if (value.event === 'stream_degraded') {
    const reasons = new Set([
      'backpressure',
      'sequence_gap',
      'partial_window',
      'coverage_gap',
      'thermal_pressure',
    ]);
    if (
      !hasOnlyKeys(
        value,
        [...identityKeys, 'reason'],
        ['affectedSequence', 'chunkStartSeconds', 'chunkEndSeconds'],
      ) ||
      typeof value.reason !== 'string' ||
      !reasons.has(value.reason) ||
      (value.affectedSequence !== undefined &&
        !isPositiveSafeInteger(value.affectedSequence))
    ) {
      return null;
    }
    const start = value.chunkStartSeconds;
    const end = value.chunkEndSeconds;
    if (
      (start === undefined) !== (end === undefined) ||
      (start !== undefined &&
        (typeof start !== 'number' ||
          !Number.isFinite(start) ||
          start < 0 ||
          typeof end !== 'number' ||
          !Number.isFinite(end) ||
          end <= start))
    ) {
      return null;
    }
    return value as NativeStreamDegradedEvent;
  }

  if (value.event === 'stream_failed') {
    const reasons = new Set([
      'invalid_request',
      'stream_not_found',
      'generation_mismatch',
      'sequence_out_of_order',
      'path_not_allowed',
      'audio_decode_failed',
      'model_unavailable',
      'inference_failed',
      'cancelled',
    ]);
    if (
      !hasOnlyKeys(value, [...identityKeys, 'reason']) ||
      typeof value.reason !== 'string' ||
      !reasons.has(value.reason)
    ) {
      return null;
    }
    return value as NativeStreamFailedEvent;
  }

  if (value.event === 'eou_update') {
    if (
      !hasOnlyKeys(value, [
        ...identityKeys,
        'processedAudioSeconds',
        'committedText',
        'tentativeText',
        'tokens',
      ]) ||
      typeof value.processedAudioSeconds !== 'number' ||
      !Number.isFinite(value.processedAudioSeconds) ||
      value.processedAudioSeconds < 0 ||
      typeof value.committedText !== 'string' ||
      typeof value.tentativeText !== 'string' ||
      !Array.isArray(value.tokens) ||
      !value.tokens.every((token) =>
        isNativeEouToken(token, value.processedAudioSeconds as number),
      )
    ) {
      return null;
    }
    return value as NativeEouUpdateEvent;
  }

  if (value.event === 'eou_failed') {
    const reasons = new Set([
      'invalid_request',
      'stream_not_found',
      'generation_mismatch',
      'source_mismatch',
      'sequence_out_of_order',
      'backpressure',
      'audio_decode_failed',
      'model_unavailable',
      'inference_failed',
      'prefix_mutated',
      'cancelled',
    ]);
    if (
      !hasOnlyKeys(value, [...identityKeys, 'reason']) ||
      typeof value.reason !== 'string' ||
      !reasons.has(value.reason)
    ) {
      return null;
    }
    return value as NativeEouFailedEvent;
  }
  return null;
}

function isNativeEouToken(
  value: unknown,
  processedAudioSeconds: number,
): value is NativeEouToken {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['text', 'startSeconds', 'endSeconds', 'committed']) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    typeof value.startSeconds !== 'number' ||
    !Number.isFinite(value.startSeconds) ||
    value.startSeconds < 0 ||
    typeof value.endSeconds !== 'number' ||
    !Number.isFinite(value.endSeconds) ||
    value.endSeconds < value.startSeconds ||
    value.endSeconds > processedAudioSeconds ||
    typeof value.committed !== 'boolean'
  ) {
    return false;
  }
  return true;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_INTEGER
  );
}
