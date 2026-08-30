import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type CalendarHelperResult,
  type CalendarMethod,
  buildCalendarRequest,
  parseCalendarMessage,
} from './protocol';
import type {
  CalendarAuthorizationStatus,
  CalendarDescriptor,
  CalendarEvent,
} from './types';

export const resolveCalendarHelperPath = (input: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  cwd: string;
}) => {
  const relativePath =
    'bin/PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper';
  return input.isPackaged
    ? path.join(input.resourcesPath, relativePath)
    : path.join(input.appPath || input.cwd, 'resources', relativePath);
};

type SpawnHelper = (
  executablePath: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

type Pending = {
  resolve: (result: CalendarHelperResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CalendarHelperClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly pending = new Map<string, Pending>();
  private readonly changeListeners = new Set<() => void>();

  constructor(
    private readonly options: {
      executablePath: string;
      spawn?: SpawnHelper;
      timeoutMs?: number;
    },
  ) {}

  isAvailable() {
    return fs.existsSync(this.options.executablePath);
  }

  authorizationStatus() {
    return this.request('authorization_status').then((result) => {
      if ('status' in result) return result.status;
      throw new Error('calendar_protocol_invalid');
    });
  }

  requestAccess() {
    return this.request('request_access').then((result) => {
      if ('status' in result) return result.status;
      throw new Error('calendar_protocol_invalid');
    });
  }

  listCalendars() {
    return this.request('list_calendars').then((result) => {
      if ('calendars' in result) return result.calendars;
      throw new Error('calendar_protocol_invalid');
    });
  }

  listEvents(calendarIdentifier: string, start: string, end: string) {
    return this.request('list_events', {
      calendarIdentifier,
      start,
      end,
    }).then((result) => {
      if ('events' in result) return result.events;
      throw new Error('calendar_protocol_invalid');
    });
  }

  onChange(listener: () => void) {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  close() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.stdin.end();
    child.kill('SIGTERM');
    this.failPending('calendar_process_closed');
  }

  private start() {
    if (this.child) return;
    const spawnHelper = this.options.spawn ?? nodeSpawn;
    const child = spawnHelper(this.options.executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.on('data', (chunk) => {
      if (this.child === child) this.consume(String(chunk));
    });
    child.stderr.on('data', () => undefined);
    child.once('error', () => this.failChild(child, 'calendar_process_error'));
    child.once('exit', () => this.failChild(child, 'calendar_process_exited'));
  }

  private request(
    method: CalendarMethod,
    params?: Record<string, string>,
  ): Promise<CalendarHelperResult> {
    this.start();
    const child = this.child;
    if (!child) return Promise.reject(new Error('calendar_process_error'));
    const id = randomUUID();
    const payload = buildCalendarRequest(method, id, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failChild(child, 'calendar_request_timeout');
      }, this.options.timeoutMs ?? 15_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch {
        this.failChild(child, 'calendar_process_write_failed');
      }
    });
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          const message = parseCalendarMessage(line);
          if (message.kind === 'event') {
            for (const listener of this.changeListeners) listener();
          } else if (message.kind === 'error') {
            const pending = message.id ? this.pending.get(message.id) : null;
            if (!pending) throw new Error('calendar_protocol_invalid');
            clearTimeout(pending.timer);
            this.pending.delete(message.id!);
            pending.reject(new Error(message.code));
          } else {
            const pending = this.pending.get(message.id);
            if (!pending) throw new Error('calendar_protocol_invalid');
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.resolve(message.result);
          }
        } catch {
          this.failCurrent('calendar_protocol_invalid');
          return;
        }
      }
      newline = this.buffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > 1_048_576) {
      this.failCurrent('calendar_protocol_invalid');
    }
  }

  private failCurrent(code: string) {
    if (this.child) this.failChild(this.child, code);
  }

  private failChild(child: ChildProcessWithoutNullStreams, code: string) {
    if (this.child !== child) return;
    this.child = null;
    this.buffer = '';
    child.stdin.end();
    child.kill('SIGTERM');
    this.failPending(code);
  }

  private failPending(code: string) {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(new Error(code));
    }
  }
}

export type CalendarClientResponse =
  | CalendarAuthorizationStatus
  | CalendarDescriptor[]
  | CalendarEvent[];
