import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  type NativeChildProcess,
  type NativeEvent,
  NativeJsonLineProcess,
} from '../../electron/transcription/nativeJsonLineProcess';

class FakeChild extends EventEmitter implements NativeChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = { write: vi.fn(() => true), end: vi.fn() };
  readonly kill = vi.fn(() => true);
}

function makeProcess(child: FakeChild) {
  return new NativeJsonLineProcess({
    executablePath: '/app/parakeet-runtime',
    args: [],
    spawn: () => child,
    requestTimeoutMs: 1_000,
  });
}

const update = (): NativeEvent => ({
  schemaVersion: 1,
  kind: 'event',
  event: 'stream_update',
  streamId: 'system-live',
  source: 'system',
  generation: 1,
  revision: 1,
  qualifiesPriorTentative: false,
  text: 'synthetic',
  confidence: 0.75,
  audioEndSeconds: 1,
});

describe('NativeJsonLineProcess live events', () => {
  it('delivers an event before resolving its correlated response', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const events: NativeEvent[] = [];
    process.onEvent((event) => events.push(event));

    const request = process.request({ schemaVersion: 1, id: 'open-1' });
    child.stdout.write(`${JSON.stringify(update())}\n`);
    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'open-1', ok: true, result: {} })}\n`,
    );

    await expect(request).resolves.toMatchObject({ id: 'open-1', ok: true });
    expect(events).toEqual([update()]);
  });

  it.each([
    { ...update(), source: 'mixed' },
    { ...update(), revision: 0 },
    { ...update(), confidence: 2 },
    { ...update(), qualifiesPriorTentative: 'yes' },
  ])(
    'fails pending work for a malformed event without echoing it',
    async (event) => {
      const child = new FakeChild();
      const process = makeProcess(child);
      const request = process.request({ schemaVersion: 1, id: 'open-1' });

      child.stdout.write(`${JSON.stringify(event)}\n`);

      await expect(request).rejects.toThrow('parakeet_protocol_invalid');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    },
  );

  it('rejects a line larger than one megabyte', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'open-1' });

    child.stdout.write(`{"private":"${'x'.repeat(1024 * 1024)}"}`);

    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('accepts multiple individually bounded lines delivered in one large chunk', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const events: NativeEvent[] = [];
    process.onEvent((event) => events.push(event));
    const request = process.request({ schemaVersion: 1, id: 'open-1' });
    const largeUpdate = update();
    largeUpdate.text = 'x'.repeat(550_000);

    child.stdout.write(
      `${JSON.stringify(largeUpdate)}\n${JSON.stringify({ ...largeUpdate, revision: 2 })}\n${JSON.stringify({ schemaVersion: 1, id: 'open-1', ok: true, result: {} })}\n`,
    );

    await expect(request).resolves.toMatchObject({ ok: true });
    expect(events).toHaveLength(2);
  });

  it.each([
    null,
    [],
    { schemaVersion: 1, id: 'open-1', ok: true, result: [] },
    {
      schemaVersion: 1,
      id: 'open-1',
      ok: true,
      result: {},
      error: { code: 'parakeet_cancelled' },
    },
    {
      schemaVersion: 1,
      id: 'open-1',
      ok: false,
      result: {},
      error: { code: 'parakeet_cancelled' },
    },
    {
      schemaVersion: 1,
      id: 'open-1',
      ok: false,
      error: { code: 'private_unknown' },
    },
    {
      schemaVersion: 1,
      id: 'open-1',
      ok: false,
      error: { code: 'parakeet_cancelled', detail: 'private' },
    },
    { schemaVersion: 1, id: 'open-1', ok: true, result: {}, extra: 'private' },
  ])(
    'terminates on a structurally invalid response envelope',
    async (response) => {
      const child = new FakeChild();
      const process = makeProcess(child);
      const request = process.request({ schemaVersion: 1, id: 'open-1' });

      child.stdout.write(`${JSON.stringify(response)}\n`);

      await expect(request).rejects.toThrow('parakeet_protocol_invalid');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    },
  );

  it('notifies lifecycle listeners and settles pending work on exit and terminate', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const failures: string[] = [];
    process.onFailure((code) => failures.push(code));
    const request = process.request({ schemaVersion: 1, id: 'open-1' });

    child.emit('exit', 9, null);

    await expect(request).rejects.toThrow('parakeet_process_exited');
    expect(failures).toEqual(['parakeet_process_exited']);

    const secondChild = new FakeChild();
    const second = makeProcess(secondChild);
    const pending = second.request({ schemaVersion: 1, id: 'open-2' });
    second.terminate();
    await expect(pending).rejects.toThrow('parakeet_process_terminated');
  });
});
