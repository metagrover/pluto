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
  speakerEvidenceResult: Record<string, unknown> | null = null;

  request = vi.fn(async (payload: Record<string, unknown>) => {
    this.requests.push(payload);
    if (payload.method === 'eou_append') {
      return await new Promise<NativeResponse>((resolve) => {
        this.pendingAppends.push({ payload, resolve });
      });
    }
    if (
      payload.method === 'eou_speaker_evidence' &&
      this.speakerEvidenceResult
    ) {
      return {
        schemaVersion: 1 as const,
        id: String(payload.id),
        ok: true,
        result: { speakerEvidence: this.speakerEvidenceResult },
      };
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
  it('enables and disables bounded evidence only through the System stream', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    await Promise.all([
      client.open(identity('mic')),
      client.open(identity('system')),
    ]);

    await client.setSpeakerEvidenceEnabled(identity('system'), true);
    await client.setSpeakerEvidenceEnabled(identity('system'), false);

    expect(process.requests.slice(-2).map((request) => request.method)).toEqual(
      ['eou_speaker_evidence_enable', 'eou_speaker_evidence_disable'],
    );
    await expect(
      client.setSpeakerEvidenceEnabled(identity('mic'), true),
    ).rejects.toThrow('parakeet_request_invalid');
  });

  it('requests and validates bounded live speaker evidence without forwarding it as an event', async () => {
    const process = new FakeTransport();
    const embedding = Array.from({ length: 256 }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    process.speakerEvidenceResult = {
      turns: [{ startTime: 1, endTime: 4, cluster: 'a' }],
      energyWindows: [
        { startTime: 1, endTime: 1.1, micRms: 0, systemRms: 0.1 },
      ],
      provenance: {
        modelIdentifier: 'speaker-diarization-offline-v1',
        modelRevision: '1ed7a662fdc7109e36d822db793ee6eebdaf8594',
        artifactDigest:
          'e0b6b63bdb2a12d087031067d61600f5e2b6b9a26f9c9e511118d2a6206349cd',
        runtimeVersion: 'fluidaudio-0.15.5',
        profileAlgorithmVersion: 'v1',
      },
      timings: { diarizationMs: 1, energyAnalysisMs: 1, totalMs: 2 },
      windowSeconds: 0.1,
      clusterEvidence: [
        {
          cluster: 'a',
          embedding,
          representativeEmbeddings: [embedding, embedding],
          cleanChunkCount: 2,
          cleanSegmentCount: 2,
          cleanDurationSeconds: 3,
          minimumChunkSimilarity: 0.8,
          meanChunkSimilarity: 0.9,
        },
      ],
    };
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    await client.open(identity('system'));

    const result = await client.speakerEvidence(identity('system'));

    expect(result.clusterEvidence?.[0]?.embedding).toHaveLength(256);
    expect(process.requests.at(-1)).toMatchObject({
      method: 'eou_speaker_evidence',
      source: 'system',
    });
  });

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

  it('shares bounded cleanup after native failure and permits a fresh client', async () => {
    vi.useFakeTimers();
    try {
      const process = new FakeTransport();
      process.request.mockImplementation(async (payload) => {
        process.requests.push(payload);
        if (payload.method === 'eou_cancel')
          return new Promise<NativeResponse>(() => {});
        return {
          schemaVersion: 1,
          id: String(payload.id),
          ok: true,
          result: {},
        };
      });
      const lease = {
        kind: 'live' as const,
        release: vi.fn(async () => {}),
        cancelAndPersistForRetry: vi.fn(),
        setPreemptionHandler: vi.fn(),
        invalidateWorker: vi.fn(async () => {}),
      };
      const client = new ParakeetEouClient({
        process,
        runtimeLease: lease,
        maxOutstandingPerSource: 4,
        cleanupTimeoutMs: 50,
      });
      let cleanup: Promise<void> | undefined;
      client.onTerminalFailure(() => {
        cleanup = client.close();
      });
      await client.open(identity('mic'));
      process.emit({
        schemaVersion: 1,
        kind: 'event',
        event: 'eou_failed',
        ...identity('mic'),
        revision: 1,
        reason: 'inference_failed',
      });
      const repeated = client.close();
      expect(repeated).toBe(cleanup);
      expect(lease.release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      await cleanup;
      await repeated;
      expect(lease.invalidateWorker).toHaveBeenCalledOnce();
      expect(lease.release).toHaveBeenCalledOnce();
      expect(lease.invalidateWorker.mock.invocationCallOrder[0]).toBeLessThan(
        lease.release.mock.invocationCallOrder[0],
      );
      expect(
        process.requests.filter((p) => p.method === 'eou_cancel'),
      ).toHaveLength(1);
      const nextProcess = new FakeTransport();
      const next = new ParakeetEouClient({
        process: nextProcess,
        maxOutstandingPerSource: 4,
      });
      await next.open({ ...identity('mic'), generation: 2 });
      await next.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates worker when native cancel takes longer than cleanup timeout on close', async () => {
    const process = new FakeTransport();
    process.request = vi.fn(async (payload: Record<string, unknown>) => {
      if (payload.method === 'eou_cancel') {
        return new Promise<NativeResponse>(() => {});
      }
      return {
        schemaVersion: 1 as const,
        id: String(payload.id),
        ok: true,
        result: {},
      };
    });
    const lease = {
      kind: 'live' as const,
      release: vi.fn(async () => {}),
      cancelAndPersistForRetry: vi.fn(),
      setPreemptionHandler: vi.fn(),
      invalidateWorker: vi.fn(async () => {}),
    };
    const client = new ParakeetEouClient({
      process,
      runtimeLease: lease,
      maxOutstandingPerSource: 4,
      cleanupTimeoutMs: 50,
    });
    await client.open(identity('mic'));

    await client.close();

    expect(lease.invalidateWorker).toHaveBeenCalledWith(
      'parakeet_cleanup_timeout',
    );
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it('rejects pending and in-flight appends with parakeet_cancelled on close', async () => {
    const process = new FakeTransport();
    const client = new ParakeetEouClient({
      process,
      maxOutstandingPerSource: 4,
    });
    await client.open(identity('mic'));

    const appendPromise = client.append(append('mic', 1));
    await client.close();

    await expect(appendPromise).rejects.toThrow('parakeet_cancelled');
  });
});
