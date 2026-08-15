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

export type NativeResponse = {
  schemaVersion: number;
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string };
};

const MAX_BUFFER_BYTES = 1024 * 1024;

export class NativeJsonLineProcess {
  private child: NativeChildProcess | null = null;
  private stdoutBuffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly ignoredResponseIDs = new Set<string>();

  constructor(
    private readonly options: {
      executablePath: string;
      args: string[];
      spawn: NativeProcessSpawn;
      requestTimeoutMs: number;
      diagnostic?: (code: string) => void;
    },
  ) {}

  start(): void {
    if (this.child) return;
    const child = this.options.spawn(
      this.options.executablePath,
      this.options.args,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;
    child.stdout.on('data', (chunk: Buffer | string) => {
      this.consumeStdout(chunk.toString());
    });
    child.stderr.on('data', () => {
      this.options.diagnostic?.('parakeet_stderr_activity');
    });
    child.once('error', () => this.failAll('parakeet_process_error'));
    child.once('exit', () => this.failAll('parakeet_process_exited'));
  }

  request(payload: Record<string, unknown>): Promise<NativeResponse> {
    this.start();
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!id || this.pending.has(id)) {
      return Promise.reject(new Error('parakeet_request_invalid'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll('parakeet_request_timeout');
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('parakeet_process_write_failed'));
      }
    });
  }

  notify(payload: Record<string, unknown>): void {
    this.start();
    try {
      this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      this.failAll('parakeet_process_write_failed');
    }
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
    this.child = null;
    this.stdoutBuffer = '';
    if (child) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_BUFFER_BYTES) {
      this.failAll('parakeet_protocol_invalid');
      return;
    }
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.consumeLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeLine(line: string): void {
    let response: NativeResponse;
    try {
      response = JSON.parse(line) as NativeResponse;
    } catch {
      this.failAll('parakeet_protocol_invalid');
      return;
    }
    if (
      response.schemaVersion !== 1 ||
      typeof response.id !== 'string' ||
      typeof response.ok !== 'boolean'
    ) {
      this.failAll('parakeet_protocol_invalid');
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      if (this.ignoredResponseIDs.delete(response.id)) return;
      this.failAll('parakeet_protocol_invalid');
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private failAll(code: string): void {
    const requests = [...this.pending.values()];
    this.pending.clear();
    this.ignoredResponseIDs.clear();
    for (const request of requests) {
      clearTimeout(request.timer);
      request.reject(new Error(code));
    }
    this.terminate();
  }
}
