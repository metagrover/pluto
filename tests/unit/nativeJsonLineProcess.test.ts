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
  committedThroughSequence: 0,
  tentativeThroughSequence: 0,
  text: 'synthetic',
  confidence: 0.75,
  audioEndSeconds: 1,
});

const eouUpdate = (): NativeEvent => ({
  schemaVersion: 1,
  kind: 'event',
  event: 'eou_update',
  streamId: 'mic-eou',
  source: 'mic',
  generation: 1,
  revision: 1,
  processedAudioSeconds: 0.32,
  committedText: 'hello',
  tentativeText: 'world',
  tokens: [
    {
      text: 'hello',
      startSeconds: 0.08,
      endSeconds: 0.16,
      committed: true,
    },
  ],
});

describe('NativeJsonLineProcess live events', () => {
  it('delivers strict byte progress correlated to a prepare request', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const events: NativeEvent[] = [];
    process.onEvent((event) => events.push(event));

    const request = process.request({ schemaVersion: 1, id: 'prepare-1' });
    const progress = {
      schemaVersion: 1,
      kind: 'event',
      event: 'prepare_progress',
      requestId: 'prepare-1',
      phase: 'downloading',
      downloadedBytes: 438_000_000,
      totalBytes: 986_000_000,
    } as const;
    child.stdout.write(`${JSON.stringify(progress)}\n`);
    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'prepare-1', ok: true, result: {} })}\n`,
    );

    await expect(request).resolves.toMatchObject({ id: 'prepare-1', ok: true });
    expect(events).toEqual([progress]);
  });

  it.each([
    { downloadedBytes: -1, totalBytes: 10 },
    { downloadedBytes: 11, totalBytes: 10 },
    { downloadedBytes: 1.5, totalBytes: 10 },
    { downloadedBytes: 1, totalBytes: 0 },
    { downloadedBytes: 0, totalBytes: 0 },
  ])('rejects malformed prepare byte progress %#', async (bytes) => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'prepare-1' });

    child.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'event',
        event: 'prepare_progress',
        requestId: 'prepare-1',
        phase: 'downloading',
        ...bytes,
      })}\n`,
    );

    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
  });

  it('accepts verification of a cached install without download byte counts', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const events: NativeEvent[] = [];
    process.onEvent((event) => events.push(event));
    const request = process.request({ schemaVersion: 1, id: 'prepare-1' });
    const progress = {
      schemaVersion: 1,
      kind: 'event',
      event: 'prepare_progress',
      requestId: 'prepare-1',
      phase: 'verifying',
      downloadedBytes: 0,
      totalBytes: 0,
    } as const;
    child.stdout.write(`${JSON.stringify(progress)}\n`);
    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'prepare-1', ok: true, result: { modelVersion: 'cached-model' } })}\n`,
    );
    await expect(request).resolves.toMatchObject({ ok: true });
    expect(events).toEqual([progress]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('ignores a stale exit after timeout restart', async () => {
    vi.useFakeTimers();
    try {
      const firstChild = new FakeChild();
      const replacement = new FakeChild();
      const children = [firstChild, replacement];
      const process = new NativeJsonLineProcess({
        executablePath: '/app/parakeet-runtime',
        args: [],
        spawn: () => {
          const child = children.shift();
          if (!child) throw new Error('unexpected spawn');
          return child;
        },
        requestTimeoutMs: 10,
      });

      const timedOut = process.request({ schemaVersion: 1, id: 'first' });
      const timeoutExpectation = expect(timedOut).rejects.toThrow(
        'parakeet_request_timeout',
      );
      await vi.advanceTimersByTimeAsync(10);
      await timeoutExpectation;

      const active = process.request({ schemaVersion: 1, id: 'second' });
      firstChild.emit('exit', 9, null);
      firstChild.emit('error', new Error('late old child error'));
      replacement.stdout.write(
        `${JSON.stringify({ schemaVersion: 1, id: 'second', ok: true, result: {} })}\n`,
      );

      await expect(active).resolves.toMatchObject({ id: 'second', ok: true });
      expect(replacement.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('parses strict EOU update and terminal failure events', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const events: NativeEvent[] = [];
    process.onEvent((event) => events.push(event));
    const request = process.request({ schemaVersion: 1, id: 'append-1' });
    const failed: NativeEvent = {
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_failed',
      streamId: 'mic-eou',
      source: 'mic',
      generation: 1,
      revision: 2,
      reason: 'prefix_mutated',
    };

    child.stdout.write(`${JSON.stringify(eouUpdate())}\n`);
    child.stdout.write(`${JSON.stringify(failed)}\n`);
    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'append-1', ok: true, result: {} })}\n`,
    );

    await expect(request).resolves.toMatchObject({ ok: true });
    expect(events).toEqual([eouUpdate(), failed]);
  });

  it.each([
    { ...eouUpdate(), processedAudioSeconds: -1 },
    { ...eouUpdate(), committedText: 3 },
    { ...eouUpdate(), tokens: {} },
    {
      ...eouUpdate(),
      tokens: [
        { text: 'x', startSeconds: 0.2, endSeconds: 0.1, committed: true },
      ],
    },
    {
      ...eouUpdate(),
      tokens: [
        { text: 'x', startSeconds: 0, endSeconds: 0.4, committed: true },
      ],
    },
  ])('rejects malformed EOU update %#', async (event) => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'append-1' });

    child.stdout.write(`${JSON.stringify(event)}\n`);

    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
  });

  it.each([
    { ...update(), source: 'mixed' },
    { ...update(), revision: 0 },
    { ...update(), confidence: 2 },
    { ...update(), qualifiesPriorTentative: 'yes' },
    { ...update(), committedThroughSequence: 0.5 },
    { ...update(), tentativeThroughSequence: -1 },
    { ...update(), committedThroughSequence: 2, tentativeThroughSequence: 1 },
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

  it('accepts a bounded multi-megabyte speaker-evidence response', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'speaker-1' });

    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'speaker-1', ok: true, result: { evidence: 'x'.repeat(2 * 1024 * 1024) } })}\n`,
    );

    await expect(request).resolves.toMatchObject({ id: 'speaker-1', ok: true });
  });

  it('rejects a line larger than sixteen megabytes', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'open-1' });

    child.stdout.write(`{"private":"${'x'.repeat(16 * 1024 * 1024)}"}`);

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
    'parakeet_audio_analysis_failed',
    'parakeet_diarization_failed',
  ] as const)(
    'accepts the declared speaker-evidence failure code %s',
    async (code) => {
      const child = new FakeChild();
      const process = makeProcess(child);
      const request = process.request({ schemaVersion: 1, id: 'speaker-1' });

      child.stdout.write(
        `${JSON.stringify({
          schemaVersion: 1,
          id: 'speaker-1',
          ok: false,
          error: { code },
        })}\n`,
      );

      await expect(request).resolves.toMatchObject({
        id: 'speaker-1',
        ok: false,
        error: { code },
      });
      expect(child.kill).not.toHaveBeenCalled();
    },
  );

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

  it('terminates when native responds with an uncorrelated request id', async () => {
    const child = new FakeChild();
    const process = makeProcess(child);
    const request = process.request({ schemaVersion: 1, id: 'eou-open-1' });

    child.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, id: 'eou-open-other', ok: true, result: {} })}\n`,
    );

    await expect(request).rejects.toThrow('parakeet_protocol_invalid');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
