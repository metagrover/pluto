import { describe, expect, it, vi } from 'vitest';

import type {
  NativeEvent,
  NativeJsonLineTransport,
  NativeResponse,
} from '../../electron/transcription/nativeJsonLineProcess';
import { ParakeetEouClient } from '../../electron/transcription/parakeetEouClient';

type Pending = {
  payload: Record<string, unknown>;
  resolve: (response: NativeResponse) => void;
};

class FakeTransport implements NativeJsonLineTransport {
  readonly requests: Record<string, unknown>[] = [];
  readonly pendingAppends: Pending[] = [];
  private eventListeners = new Set<(event: NativeEvent) => void>();
  private failureListeners = new Set<(code: string) => void>();

  request = vi.fn(async (payload: Record<string, unknown>) => {
    this.requests.push(payload);
    if (payload.method === 'eou_append') {
      return await new Promise<NativeResponse>((resolve) => {
        this.pendingAppends.push({ payload, resolve });
      });
    }
    return {
      schemaVersion: 1 as const,
      id: String(payload.id),
      ok: true,
      result: {},
    };
  });
  notify = vi.fn();
  cancelPending = vi.fn();
  ignoreResponse = vi.fn();
  onEvent(listener: (event: NativeEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  onFailure(listener: (code: string) => void) {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }
  emit(event: NativeEvent) {
    for (const listener of this.eventListeners) listener(event);
  }
  fail(code: string) {
    for (const listener of this.failureListeners) listener(code);
  }
  resolveAppend(index: number) {
    const pending = this.pendingAppends[index]!;
    pending.resolve({
      schemaVersion: 1,
      id: String(pending.payload.id),
      ok: true,
      result: {},
    });
  }
}

const identity = (source: 'mic' | 'system') => ({
  streamId: `eou-meeting-1-${source}`,
  source,
  generation: 1,
});

const append = (source: 'mic' | 'system', sequence: number) => ({
  ...identity(source),
  sequence,
  sampleRate: 16_000,
  samples: new Float32Array(5_120),
  audioStartSeconds: (sequence - 1) * 0.32,
  audioEndSeconds: sequence * 0.32,
});

describe('ParakeetEouClient', () => {
  it('opens exactly one independent stream for each source', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });

    await Promise.all([
      client.open(identity('mic')),
      client.open(identity('system')),
    ]);

    expect(
      process.requests.filter((request) => request.method === 'eou_open'),
    ).toEqual([
      expect.objectContaining(identity('mic')),
      expect.objectContaining(identity('system')),
    ]);
    await expect(
      client.open({ ...identity('mic'), streamId: 'another-mic' }),
    ).rejects.toThrow('parakeet_stream_capacity');
  });

  it('reserves a source before concurrent open work can race', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });

    const attempts = await Promise.allSettled([
      client.open(identity('mic')),
      client.open({ ...identity('mic'), streamId: 'another-mic' }),
    ]);

    expect(attempts.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      process.requests.filter((request) => request.method === 'eou_open'),
    ).toHaveLength(1);
  });

  it('uses independent source FIFOs with a hard per-source outstanding bound', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 2,
    });
    await Promise.all([
      client.open(identity('mic')),
      client.open(identity('system')),
    ]);

    const mic1 = client.append(append('mic', 1));
    const mic2 = client.append(append('mic', 2));
    const system1 = client.append(append('system', 1));
    await expect(client.append(append('mic', 3))).rejects.toThrow(
      'parakeet_backpressure',
    );

    expect(process.pendingAppends.map(({ payload }) => payload.source)).toEqual(
      ['mic', 'system'],
    );
    process.resolveAppend(1);
    await system1;
    process.resolveAppend(0);
    await mic1;
    expect(process.pendingAppends[2]?.payload).toMatchObject({
      source: 'mic',
      sequence: 2,
    });
    process.resolveAppend(2);
    await mic2;
  });

  it('encodes little-endian PCM and drains queued appends before finish', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    await client.open(identity('mic'));

    const first = client.append({
      ...append('mic', 1),
      samples: new Float32Array([0.5, -0.25]),
      sampleRate: 8_000,
      audioStartSeconds: 0,
      audioEndSeconds: 2 / 8_000,
    });
    const finishing = client.finish(identity('mic'));
    expect(
      process.requests.some((request) => request.method === 'eou_finish'),
    ).toBe(false);

    expect(
      Buffer.from(
        String(process.pendingAppends[0]!.payload.pcmBase64),
        'base64',
      ).readFloatLE(0),
    ).toBe(0.5);
    process.resolveAppend(0);
    await first;
    await finishing;
    expect(process.requests.at(-1)).toMatchObject({
      method: 'eou_finish',
      ...identity('mic'),
    });
  });

  it('fences updates by identity and strict revision', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    const updates = vi.fn();
    const failures = vi.fn();
    client.onUpdate(updates);
    client.onTerminalFailure(failures);
    await client.open(identity('mic'));

    process.emit({
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_update',
      ...identity('mic'),
      revision: 1,
      processedAudioSeconds: 0.32,
      committedText: 'hello',
      tentativeText: '',
      tokens: [],
    });
    process.emit({
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_update',
      ...identity('mic'),
      revision: 3,
      processedAudioSeconds: 0.64,
      committedText: 'hello',
      tentativeText: 'there',
      tokens: [],
    });

    expect(updates).toHaveBeenCalledOnce();
    expect(failures).toHaveBeenCalledWith('parakeet_event_out_of_order');
  });

  it('cancels both streams exactly once when either native stream fails', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    const failures = vi.fn();
    client.onTerminalFailure(failures);
    await Promise.all([
      client.open(identity('mic')),
      client.open(identity('system')),
    ]);

    process.emit({
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_failed',
      ...identity('mic'),
      revision: 1,
      reason: 'inference_failed',
    });
    await vi.waitFor(() => {
      expect(
        process.requests.filter((request) => request.method === 'eou_cancel'),
      ).toHaveLength(2);
    });
    process.emit({
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_failed',
      ...identity('system'),
      revision: 1,
      reason: 'cancelled',
    });

    expect(failures).toHaveBeenCalledOnce();
  });

  it('releases its single supplied live lease only after every stream closes', async () => {
    const process = new FakeTransport();
    const lease = {
      kind: 'live' as const,
      release: vi.fn(async () => {}),
      cancelAndPersistForRetry: vi.fn(),
      setPreemptionHandler: vi.fn(),
    };
    const client = new ParakeetEouClient({
      process,
      runtimeLease: lease,
      maxOutstandingPerSource: 4,
    });
    await Promise.all([
      client.open(identity('mic')),
      client.open(identity('system')),
    ]);
    await client.finish(identity('mic'));
    expect(lease.release).not.toHaveBeenCalled();
    await client.finish(identity('system'));
    expect(lease.release).toHaveBeenCalledOnce();
  });
});
