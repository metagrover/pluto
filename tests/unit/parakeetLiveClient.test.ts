import { describe, expect, it, vi } from 'vitest';

import type {
  NativeEvent,
  NativeJsonLineTransport,
  NativeResponse,
} from '../../electron/transcription/nativeJsonLineProcess';
import { ParakeetLiveClient } from '../../electron/transcription/parakeetLiveClient';

class FakeTransport implements NativeJsonLineTransport {
  readonly writes: Array<Record<string, unknown>> = [];
  readonly pending: Array<{
    payload: Record<string, unknown>;
    resolve: (response: NativeResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  private listener: ((event: NativeEvent) => void) | undefined;

  request(payload: Record<string, unknown>): Promise<NativeResponse> {
    this.writes.push(payload);
    return new Promise((resolve, reject) => {
      this.pending.push({ payload, resolve, reject });
    });
  }

  onEvent(listener: (event: NativeEvent) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  cancelPending(): void {}
  ignoreResponse(): void {}
  notify(payload: Record<string, unknown>): void {
    this.writes.push(payload);
  }
  terminate(): void {}

  respondNext(result: Record<string, unknown> = {}): void {
    const next = this.pending.shift();
    if (!next) throw new Error('no pending request');
    next.resolve({
      schemaVersion: 1,
      id: String(next.payload.id),
      ok: true,
      result,
    });
  }

  rejectNext(code: string): void {
    const next = this.pending.shift();
    if (!next) throw new Error('no pending request');
    next.reject(new Error(code));
  }

  emit(event: NativeEvent): void {
    this.listener?.(event);
  }
}

const openSystem = {
  streamId: 'system-live',
  source: 'system' as const,
  generation: 1,
};

const append = (sequence: number) => ({
  ...openSystem,
  sequence,
  audioPath: `/recordings/system-${sequence}.wav`,
  chunkStartSeconds: sequence - 1,
  chunkEndSeconds: sequence,
});

const update = (overrides: Partial<NativeEvent> = {}): NativeEvent =>
  ({
    schemaVersion: 1,
    kind: 'event',
    event: 'stream_update',
    ...openSystem,
    revision: 1,
    qualifiesPriorTentative: false,
    text: 'synthetic',
    confidence: 0.8,
    audioEndSeconds: 1,
    ...overrides,
  }) as NativeEvent;

async function opened(maxQueuedAppends = 2) {
  const process = new FakeTransport();
  const client = new ParakeetLiveClient({ process, maxQueuedAppends });
  const opening = client.open(openSystem);
  process.respondNext();
  await opening;
  return { process, client };
}

describe('ParakeetLiveClient', () => {
  it('publishes valid events without failing the pending response', async () => {
    const process = new FakeTransport();
    const client = new ParakeetLiveClient({ process, maxQueuedAppends: 2 });
    const updates: NativeEvent[] = [];
    client.onEvent((event) => updates.push(event));

    const opening = client.open(openSystem);
    process.emit(update());
    process.respondNext();

    await expect(opening).resolves.toBeUndefined();
    expect(updates).toEqual([update()]);
  });

  it('owns at most one stream per source and two streams total', async () => {
    const process = new FakeTransport();
    const client = new ParakeetLiveClient({ process, maxQueuedAppends: 2 });
    const first = client.open(openSystem);
    process.respondNext();
    await first;

    await expect(
      client.open({ streamId: 'system-two', source: 'system', generation: 1 }),
    ).rejects.toThrow('parakeet_stream_capacity');

    const mic = client.open({
      streamId: 'mic-live',
      source: 'mic',
      generation: 1,
    });
    process.respondNext();
    await mic;
    await expect(
      client.open({ streamId: 'mic-two', source: 'mic', generation: 1 }),
    ).rejects.toThrow('parakeet_stream_capacity');
  });

  it('serializes appends per stream while allowing the other source to proceed', async () => {
    const process = new FakeTransport();
    const client = new ParakeetLiveClient({ process, maxQueuedAppends: 2 });
    const systemOpen = client.open(openSystem);
    process.respondNext();
    await systemOpen;
    const micIdentity = {
      streamId: 'mic-live',
      source: 'mic' as const,
      generation: 1,
    };
    const micOpen = client.open(micIdentity);
    process.respondNext();
    await micOpen;

    const first = client.append(append(1));
    const second = client.append(append(2));
    const mic = client.append({
      ...micIdentity,
      sequence: 1,
      audioPath: '/recordings/mic-1.wav',
      chunkStartSeconds: 0,
      chunkEndSeconds: 1,
    });

    await vi.waitFor(() =>
      expect(
        process.writes.filter((request) => request.method === 'stream_append'),
      ).toHaveLength(2),
    );
    process.respondNext();
    process.respondNext();
    await first;
    await mic;
    await vi.waitFor(() =>
      expect(
        process.writes.filter((request) => request.method === 'stream_append'),
      ).toHaveLength(3),
    );
    process.respondNext();
    await second;
  });

  it('rejects sequence gaps and bounded queue overflow before writing', async () => {
    const { process, client } = await opened(1);
    await expect(client.append(append(2))).rejects.toThrow(
      'parakeet_sequence_out_of_order',
    );

    const first = client.append(append(1));
    const second = client.append(append(2));
    await expect(client.append(append(3))).rejects.toThrow(
      'parakeet_backpressure',
    );
    process.respondNext();
    await first;
    await vi.waitFor(() => expect(process.pending).toHaveLength(1));
    process.respondNext();
    await second;
  });

  it('waits for the last accepted append before flushing', async () => {
    const { process, client } = await opened();
    const first = client.append(append(1));
    const flush = client.flush(openSystem);

    await vi.waitFor(() =>
      expect(process.writes.at(-1)?.method).toBe('stream_append'),
    );
    process.respondNext();
    await first;
    await vi.waitFor(() =>
      expect(process.writes.at(-1)?.method).toBe('stream_flush'),
    );
    process.respondNext({ finalPreview: 'not exposed as canonical' });
    await flush;
  });

  it('rejects stale, duplicate, and out-of-order revisions', async () => {
    const { process, client } = await opened();
    const accepted: NativeEvent[] = [];
    const rejected: string[] = [];
    client.onEvent((event) => accepted.push(event));
    client.onProtocolError((code) => rejected.push(code));

    process.emit(update({ revision: 1 }));
    process.emit(update({ revision: 1 }));
    process.emit(update({ revision: 3 }));
    process.emit(update({ generation: 2, revision: 2 }));
    process.emit(update({ revision: 2 }));

    expect(accepted.map((event) => event.revision)).toEqual([1, 2]);
    expect(rejected).toEqual([
      'parakeet_event_out_of_order',
      'parakeet_event_out_of_order',
      'parakeet_event_stale',
    ]);
  });

  it('cancels a stream and ignores all late events', async () => {
    const { process, client } = await opened();
    const accepted: NativeEvent[] = [];
    client.onEvent((event) => accepted.push(event));

    const cancelling = client.cancel(openSystem);
    process.emit(update());
    process.respondNext();
    await cancelling;

    expect(accepted).toEqual([]);
    await expect(client.append(append(1))).rejects.toThrow(
      'parakeet_stream_not_found',
    );
  });

  it('rejects malformed identities, aborts queued appends, and surfaces process exit', async () => {
    const { process, client } = await opened();
    await expect(
      client.open({ streamId: '../secret', source: 'mic', generation: 1 }),
    ).rejects.toThrow('parakeet_request_invalid');

    const first = client.append(append(1));
    const controller = new AbortController();
    const second = client.append({ ...append(2), signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toThrow('parakeet_cancelled');
    process.rejectNext('parakeet_process_exited');
    await expect(first).rejects.toThrow('parakeet_process_exited');
    await expect(client.append(append(3))).rejects.toThrow(
      'parakeet_stream_not_found',
    );
  });

  it('cancels an in-flight native append when its abort signal fires', async () => {
    const { process, client } = await opened();
    const controller = new AbortController();
    const appending = client.append({
      ...append(1),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(process.pending).toHaveLength(1));
    const targetId = process.pending[0]?.payload.id;

    controller.abort();

    await expect(appending).rejects.toThrow('parakeet_cancelled');
    expect(process.writes.at(-1)).toMatchObject({
      method: 'cancel',
      targetId,
    });
  });
});
