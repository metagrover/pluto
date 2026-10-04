import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  CalendarHelperClient,
  resolveCalendarHelperPath,
} from '../../electron/calendar/client';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = { write: vi.fn(() => true), end: vi.fn() };
  kill = vi.fn(() => true);
}

describe('calendar helper client', () => {
  it('resolves only the known helper bundle path', () => {
    expect(
      resolveCalendarHelperPath({
        isPackaged: true,
        resourcesPath: '/Applications/Pluto.app/Contents/Resources',
        appPath: '/unused',
        cwd: '/unused',
      }),
    ).toBe(
      '/Applications/Pluto.app/Contents/Resources/bin/PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
    );
    expect(
      resolveCalendarHelperPath({
        isPackaged: false,
        resourcesPath: '/unused',
        appPath: '/repo',
        cwd: '/other',
      }),
    ).toBe(
      '/repo/resources/bin/PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
    );
  });

  it('correlates validated responses and emits store-change events', async () => {
    const child = new FakeChild();
    const client = new CalendarHelperClient({
      executablePath: '/helper',
      spawn: () => child as never,
      timeoutMs: 1_000,
    });
    const changed = vi.fn();
    client.onChange(changed);

    const pending = client.authorizationStatus();
    const payload = JSON.parse(String(child.stdin.write.mock.calls[0][0]));
    child.stdout.write(
      `${JSON.stringify({ version: 1, event: 'event_store_changed' })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({ version: 1, id: payload.id, result: { status: 'full_access' } })}\n`,
    );

    await expect(pending).resolves.toBe('full_access');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps the helper alive while a user answers the permission prompt', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const client = new CalendarHelperClient({
      executablePath: '/helper',
      spawn: () => child as never,
    });
    try {
      const pending = client.requestAccess();
      const payload = JSON.parse(String(child.stdin.write.mock.calls[0][0]));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(child.kill).not.toHaveBeenCalled();
      child.stdout.write(
        `${JSON.stringify({ version: 1, id: payload.id, result: { status: 'full_access' } })}\n`,
      );
      await expect(pending).resolves.toBe('full_access');
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out unanswered permission requests and permits a fresh helper', async () => {
    vi.useFakeTimers();
    const children = [new FakeChild(), new FakeChild()];
    const spawn = vi
      .fn()
      .mockReturnValueOnce(children[0])
      .mockReturnValueOnce(children[1]);
    const client = new CalendarHelperClient({
      executablePath: '/helper',
      spawn,
      permissionTimeoutMs: 100,
    });
    try {
      const pending = expect(client.requestAccess()).rejects.toThrow(
        'calendar_request_timeout',
      );
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(children[0].kill).toHaveBeenCalled();
      const retry = client.authorizationStatus();
      const payload = JSON.parse(
        String(children[1].stdin.write.mock.calls[0][0]),
      );
      children[1].stdout.write(
        `${JSON.stringify({ version: 1, id: payload.id, result: { status: 'denied' } })}\n`,
      );
      await expect(retry).resolves.toBe('denied');
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed and terminates on malformed native output', async () => {
    const child = new FakeChild();
    const client = new CalendarHelperClient({
      executablePath: '/helper',
      spawn: () => child as never,
      timeoutMs: 1_000,
    });
    const pending = client.listCalendars();
    child.stdout.write('not json\n');
    await expect(pending).rejects.toThrow('calendar_protocol_invalid');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
