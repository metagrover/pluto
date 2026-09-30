import { describe, expect, it, vi } from 'vitest';

import {
  type EouRendererTransport,
  createEouRendererSession,
} from '../../src/services/liveTranscription/eouRendererSession';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeTransport = () => {
  let updateListener: ((payload: unknown) => void) | undefined;
  let unavailableListener: ((payload: unknown) => void) | undefined;
  const transport: EouRendererTransport & {
    emitUpdate(payload: unknown): void;
    emitUnavailable(payload: unknown): void;
  } = {
    invoke: vi.fn(async () => ({})),
    onUpdate(listener) {
      updateListener = listener;
      return () => {
        updateListener = undefined;
      };
    },
    onUnavailable(listener) {
      unavailableListener = listener;
      return () => {
        unavailableListener = undefined;
      };
    },
    emitUpdate(payload) {
      updateListener?.(payload);
    },
    emitUnavailable(payload) {
      unavailableListener?.(payload);
    },
  };
  return transport;
};

const makeSession = (
  transport = makeTransport(),
  extraOptions?: Partial<Parameters<typeof createEouRendererSession>[0]>,
) => {
  const onSegments = vi.fn();
  const onUnavailable = vi.fn();
  return {
    transport,
    onSegments,
    onUnavailable,
    session: createEouRendererSession({
      meetingId: 'meeting-1',
      generation: 1,
      sampleRates: { mic: 8_000, system: 8_000 },
      transport,
      onSegments,
      onUnavailable,
      ...extraOptions,
    }),
  };
};

describe('EOU renderer session', () => {
  it('builds echo evidence while native recognition is still backlogged', async () => {
    const blockedAppend = deferred<unknown>();
    const transport = makeTransport();
    vi.mocked(transport.invoke).mockImplementation((channel) =>
      channel === 'PARAKEET_EOU_APPEND'
        ? blockedAppend.promise
        : Promise.resolve({}),
    );
    const { session, onSegments } = makeSession(transport, {
      nowSeconds: () => 0.32,
    });
    await session.start();
    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: {
        streamId: 'eou-meeting-1-system',
        source: 'system',
        generation: 1,
        revision: 1,
        processedAudioSeconds: 0.32,
        committedText: 'reference',
        tentativeText: '',
        tokens: [
          {
            text: 'reference',
            startSeconds: 0,
            endSeconds: 0.2,
            committed: true,
          },
        ],
      },
    });
    const waveform = Float32Array.from({ length: 8_000 * 3 }, (_, sample) => {
      const bin = Math.floor(sample / 80);
      const amplitude =
        0.03 + ((Math.imul(bin + 7, 1_103_515_245) >>> 8) % 100) / 500;
      return amplitude * Math.sin((2 * Math.PI * 500 * sample) / 8_000);
    });

    session.append('system', waveform);
    session.append(
      'mic',
      waveform.map((sample) => sample * 0.6),
    );

    expect(
      onSegments.mock.calls.some((call) => call[2] === 'echo_evidence'),
    ).toBe(true);
    expect(
      vi
        .mocked(transport.invoke)
        .mock.calls.filter(([channel]) => channel === 'PARAKEET_EOU_APPEND'),
    ).toHaveLength(2);

    blockedAppend.resolve({});
    await session.drain();
    session.cancel();
  });

  it('publishes acoustic echo evidence on the same meeting clock as its tokens', async () => {
    const transport = makeTransport();
    const onSegments = vi.fn();
    let meetingSeconds = 10.32;
    const session = createEouRendererSession({
      meetingId: 'meeting-1',
      generation: 1,
      sampleRates: { mic: 8_000, system: 8_000 },
      nowSeconds: () => meetingSeconds,
      transport,
      onSegments,
      onUnavailable: vi.fn(),
    });
    await session.start();
    const waveform = (sample: number): number => {
      if (sample < 0) return 0;
      const bin = Math.floor(sample / 80);
      const amplitude =
        0.03 + ((Math.imul(bin + 7, 1_103_515_245) >>> 8) % 100) / 500;
      return amplitude * Math.sin((2 * Math.PI * 500 * sample) / 8_000);
    };
    for (let frame = 0; frame < 20; frame += 1) {
      meetingSeconds = 10 + (frame + 1) * 0.32;
      session.append(
        'mic',
        Float32Array.from(
          { length: 2_560 },
          (_, sample) => 0.6 * waveform(frame * 2_560 + sample - 2_240),
        ),
      );
      meetingSeconds += 0.16;
      session.append(
        'system',
        Float32Array.from({ length: 2_560 }, (_, sample) =>
          waveform(frame * 2_560 + sample),
        ),
      );
      await session.drain();
      if (frame === 3) {
        transport.emitUpdate({
          meetingId: 'meeting-1',
          generation: 1,
          event: {
            streamId: 'eou-meeting-1-system',
            source: 'system',
            generation: 1,
            revision: 1,
            processedAudioSeconds: 1.28,
            committedText: 'reference',
            tentativeText: '',
            tokens: [
              {
                text: 'reference',
                startSeconds: 1,
                endSeconds: 1.2,
                committed: true,
              },
            ],
          },
        });
        // Earlier speech can already have proof; this recognized word does not.
        for (const window of onSegments.mock.calls.at(-1)?.[1] ?? []) {
          expect(window.systemEndMs).toBeLessThanOrEqual(11_160);
        }
      }
    }
    const [segments, evidence] = onSegments.mock.calls.at(-1) ?? [];
    expect(segments).toEqual(onSegments.mock.calls[0][0]);
    expect(onSegments.mock.calls[0][2]).toBe('recognition');
    expect(onSegments.mock.calls.at(-1)?.[2]).toBe('echo_evidence');
    expect(segments[0].timestampMs).toBeCloseTo(11_160);
    expect(evidence).toEqual(expect.any(Array));
    expect(evidence.length).toBeGreaterThan(0);
    expect(
      evidence.some(
        (window: { systemStartMs: number; systemEndMs: number }) =>
          window.systemStartMs <= 11_160 && window.systemEndMs >= 11_360,
      ),
    ).toBe(true);
    for (const window of evidence) {
      expect(window.micStartMs).toBeGreaterThanOrEqual(10_000);
      expect(window.systemStartMs).toBeGreaterThanOrEqual(10_160);
      expect(window.micStartMs - window.systemStartMs).toBeCloseTo(120, -1);
    }
    session.cancel();
    const fresh = makeSession();
    await fresh.session.start();
    fresh.transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: {
        streamId: 'eou-meeting-1-system',
        source: 'system',
        generation: 1,
        revision: 1,
        processedAudioSeconds: 0.32,
        committedText: 'new',
        tentativeText: '',
        tokens: [
          { text: 'new', startSeconds: 0, endSeconds: 0.2, committed: true },
        ],
      },
    });
    expect(fresh.onSegments.mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it('starts once and dispatches independent mic and System 320 ms frames', async () => {
    const { session, transport } = makeSession();
    await session.start();

    session.append('mic', new Float32Array(2_560));
    session.append('system', new Float32Array(2_560));
    await session.drain();

    expect(transport.invoke).toHaveBeenCalledWith('PARAKEET_EOU_START', {
      meetingId: 'meeting-1',
      generation: 1,
    });
    expect(transport.invoke).toHaveBeenCalledWith(
      'PARAKEET_EOU_APPEND',
      expect.objectContaining({
        meetingId: 'meeting-1',
        source: 'mic',
        sequence: 1,
      }),
    );
    expect(transport.invoke).toHaveBeenCalledWith(
      'PARAKEET_EOU_APPEND',
      expect.objectContaining({
        meetingId: 'meeting-1',
        source: 'system',
        sequence: 1,
      }),
    );
  });

  it('aligns independent source token clocks to their first meeting-clock sample', async () => {
    const transport = makeTransport();
    const onSegments = vi.fn();
    let meetingSeconds = 3;
    const session = createEouRendererSession({
      meetingId: 'meeting-1',
      generation: 1,
      sampleRates: { mic: 8_000, system: 8_000 },
      transport,
      nowSeconds: () => meetingSeconds,
      onSegments,
      onUnavailable: vi.fn(),
    });
    await session.start();
    session.append('mic', new Float32Array(2_560));
    meetingSeconds = 4.5;
    session.append('system', new Float32Array(2_560));

    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: {
        streamId: 'eou-meeting-1-system',
        source: 'system',
        generation: 1,
        revision: 1,
        processedAudioSeconds: 0.32,
        committedText: 'hello',
        tentativeText: '',
        tokens: [
          { text: 'hello', startSeconds: 0, endSeconds: 0.2, committed: true },
        ],
      },
    });

    expect(onSegments).toHaveBeenCalledWith(
      [expect.objectContaining({ timestampMs: 4_180, endTimestampMs: 4_380 })],
      [],
      'recognition',
    );
  });

  it('uses capture time instead of delayed callback time when provided', async () => {
    const transport = makeTransport();
    const onSegments = vi.fn();
    const session = createEouRendererSession({
      meetingId: 'meeting-1',
      generation: 1,
      sampleRates: { mic: 8_000, system: 8_000 },
      transport,
      nowSeconds: () => 20,
      onSegments,
      onUnavailable: vi.fn(),
    });
    await session.start();
    session.append('system', new Float32Array(2_560), {
      captureStartSeconds: 4,
    });
    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: {
        streamId: 'eou-meeting-1-system',
        source: 'system',
        generation: 1,
        revision: 1,
        processedAudioSeconds: 0.32,
        committedText: 'hello',
        tentativeText: '',
        tokens: [
          { text: 'hello', startSeconds: 0, endSeconds: 0.2, committed: true },
        ],
      },
    });

    expect(onSegments).toHaveBeenCalledWith(
      [expect.objectContaining({ timestampMs: 4_000, endTimestampMs: 4_200 })],
      [],
      'recognition',
    );
  });

  it('fails unavailable once at four outstanding frames without stopping capture', async () => {
    const transport = makeTransport();
    const blocked = deferred<unknown>();
    transport.invoke = vi.fn((channel) =>
      channel === 'PARAKEET_EOU_APPEND' ? blocked.promise : Promise.resolve({}),
    );
    const { session, onUnavailable } = makeSession(transport, {
      maxOutstanding: 4,
    });
    await session.start();

    session.append('mic', new Float32Array(2_560 * 5));
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
    session.append('system', new Float32Array(2_560));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_backpressure');
    expect(transport.invoke).toHaveBeenCalledWith(
      'PARAKEET_EOU_CANCEL',
      expect.objectContaining({
        code: 'parakeet_backpressure',
        backpressure: expect.objectContaining({
          source: 'mic',
          retainedSeconds: 0,
          incomingSeconds: 1.6,
          inFlight: false,
        }),
      }),
    );
    expect(transport.invoke).not.toHaveBeenCalledWith(
      'STOP_RECORDING',
      expect.anything(),
    );
    blocked.resolve({});
  });

  it('accepts only its meeting/generation updates and never recovers after unavailable', async () => {
    const { session, transport, onSegments, onUnavailable } = makeSession();
    await session.start();
    const event = {
      streamId: 'eou-meeting-1-mic',
      source: 'mic' as const,
      generation: 1,
      revision: 1,
      processedAudioSeconds: 0.32,
      committedText: 'hello',
      tentativeText: '',
      tokens: [
        { text: 'hello', startSeconds: 0, endSeconds: 0.2, committed: true },
      ],
    };

    transport.emitUpdate({ meetingId: 'other', generation: 1, event });
    transport.emitUpdate({ meetingId: 'meeting-1', generation: 1, event });
    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: { ...event, revision: 2, committedText: 'goodbye' },
    });
    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: { ...event, revision: 2, tentativeText: 'late' },
    });

    expect(onSegments).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith('parakeet_prefix_mutated');
    expect(session.status()).toBe('unavailable');
  });

  it('flushes partial tails, drains appends, then finishes native', async () => {
    const transport = makeTransport();
    const appendDone = deferred<unknown>();
    transport.invoke = vi.fn((channel) =>
      channel === 'PARAKEET_EOU_APPEND'
        ? appendDone.promise
        : Promise.resolve({}),
    );
    const { session } = makeSession(transport);
    await session.start();
    session.append('mic', new Float32Array(100));

    const finish = session.finish();
    expect(transport.invoke).not.toHaveBeenCalledWith(
      'PARAKEET_EOU_FINISH',
      expect.anything(),
    );
    appendDone.resolve({});
    await finish;

    expect(transport.invoke).toHaveBeenCalledWith('PARAKEET_EOU_FINISH', {
      meetingId: 'meeting-1',
      generation: 1,
    });
  });

  it('accepts the final native update emitted before finish resolves', async () => {
    const transport = makeTransport();
    const { session, onSegments } = makeSession(transport);
    transport.invoke = vi.fn(async (channel) => {
      if (channel === 'PARAKEET_EOU_FINISH') {
        transport.emitUpdate({
          meetingId: 'meeting-1',
          generation: 1,
          event: {
            streamId: 'eou-meeting-1-mic',
            source: 'mic',
            generation: 1,
            revision: 1,
            processedAudioSeconds: 0.1,
            committedText: 'final tail',
            tentativeText: '',
            tokens: [],
          },
        });
      }
      return {};
    });
    await session.start();

    await session.finish();

    expect(onSegments).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          text: 'Final tail.',
          rawText: 'final tail',
          speaker: 'Speaker',
          confirmed: true,
        }),
      ],
      [],
      'recognition',
    );
  });

  it('switches unavailable once when an append rejects', async () => {
    const transport = makeTransport();
    transport.invoke = vi.fn((channel) =>
      channel === 'PARAKEET_EOU_APPEND'
        ? Promise.reject(new Error('native detail'))
        : Promise.resolve({}),
    );
    const { session, onUnavailable } = makeSession(transport);
    await session.start();

    session.append('mic', new Float32Array(2_560));
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
    session.append('mic', new Float32Array(2_560));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_live_unavailable');
  });

  it('buffers samples while starting and replays them once start completes', async () => {
    const transport = makeTransport();
    const startDeferred = deferred<unknown>();
    const appendCalls: unknown[] = [];
    transport.invoke = vi.fn((channel, payload) => {
      if (channel === 'PARAKEET_EOU_START') {
        return startDeferred.promise;
      }
      if (channel === 'PARAKEET_EOU_APPEND') {
        appendCalls.push(payload);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    const { session } = makeSession(transport);
    const startPromise = session.start();

    expect(session.status()).toBe('starting');
    // Append while starting - should not be dropped
    session.append('mic', new Float32Array(2_560));
    expect(appendCalls).toHaveLength(0);

    // Now let start complete
    startDeferred.resolve({});
    await startPromise;

    expect(session.status()).toBe('ready');
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]).toMatchObject({
      source: 'mic',
      meetingId: 'meeting-1',
    });
  });

  it('handles a main-process startup cancellation without restoring readiness', async () => {
    const transport = makeTransport();
    vi.mocked(transport.invoke).mockImplementation((channel) =>
      Promise.resolve(
        channel === 'PARAKEET_EOU_START' ? { cancelled: true } : {},
      ),
    );
    const { session, onUnavailable } = makeSession(transport);

    await expect(session.start()).resolves.toBeUndefined();

    expect(session.status()).toBe('unavailable');
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith('parakeet_cancelled');
    expect(transport.invoke).toHaveBeenCalledWith('PARAKEET_EOU_CANCEL', {
      meetingId: 'meeting-1',
      generation: 1,
      code: 'parakeet_cancelled',
    });
  });

  it('buffers 49 320ms mic frames before readiness and dispatches all 49 in order without backpressure', async () => {
    const transport = makeTransport();
    const startDeferred = deferred<unknown>();
    const appendCalls: Array<{ sequence: number; audioStartSeconds: number }> =
      [];
    transport.invoke = vi.fn((channel, payload) => {
      if (channel === 'PARAKEET_EOU_START') return startDeferred.promise;
      if (channel === 'PARAKEET_EOU_APPEND') {
        appendCalls.push(
          payload as { sequence: number; audioStartSeconds: number },
        );
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    const { session, onUnavailable } = makeSession(transport);
    const startPromise = session.start();

    // 49 frames of 320ms at 8000Hz = 2,560 samples each
    for (let i = 0; i < 49; i++) {
      session.append('mic', new Float32Array(2_560));
    }
    expect(appendCalls).toHaveLength(0);

    // Resolve start and wait for pump to dispatch all frames
    startDeferred.resolve({});
    await startPromise;
    await session.drain();

    expect(onUnavailable).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(49);
    for (let i = 0; i < 49; i++) {
      expect(appendCalls[i].sequence).toBe(i + 1);
      expect(appendCalls[i].audioStartSeconds).toBeCloseTo(i * 0.32, 2);
    }
  });

  it('retains all 130 ten-ms buffers during startup and one afterward without discarding audio or shortening time', async () => {
    const transport = makeTransport();
    const startDeferred = deferred<unknown>();
    const appendCalls: Array<{ samples: Float32Array; sequence: number }> = [];
    transport.invoke = vi.fn((channel, payload) => {
      if (channel === 'PARAKEET_EOU_START') return startDeferred.promise;
      if (channel === 'PARAKEET_EOU_APPEND') {
        appendCalls.push(
          payload as { samples: Float32Array; sequence: number },
        );
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    const { session, onUnavailable } = makeSession(transport);
    const startPromise = session.start();

    // 130 x 10ms at 8000Hz = 80 samples each (total 10,400 samples)
    for (let i = 0; i < 130; i++) {
      session.append('mic', new Float32Array(80).fill(1));
    }
    expect(appendCalls).toHaveLength(0);

    startDeferred.resolve({});
    await startPromise;

    // Buffer 131: 80 samples
    session.append('mic', new Float32Array(80).fill(2));
    await session.finish();

    expect(onUnavailable).not.toHaveBeenCalled();
    // 131 * 80 = 10,480 samples total.
    // Chunked into 320ms frames (2,560 samples): 4 full frames + 1 tail frame
    const totalSamplesDispatched = appendCalls.reduce(
      (acc, c) => acc + c.samples.length,
      0,
    );
    expect(totalSamplesDispatched).toBe(10_480);
    expect(appendCalls).toHaveLength(5);
  });

  it('fails explicitly with parakeet_backpressure when retained duration exceeds configured budget', async () => {
    const transport = makeTransport();
    const { session, onUnavailable } = makeSession(transport, {
      maxRetainedAudioSecondsPerSource: 1.0, // 1 second limit
    });
    await session.start();

    // 1 second at 8000Hz is 8000 samples. 2560 * 4 = 10,240 samples = 1.28s > 1.0s
    session.append('mic', new Float32Array(2_560 * 4));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_backpressure');
    expect(session.status()).toBe('unavailable');
  });

  it('fails explicitly with parakeet_backpressure when startup buffering exceeds duration limit', async () => {
    const transport = makeTransport();
    const startDeferred = deferred<unknown>();
    transport.invoke = vi.fn((channel) => {
      if (channel === 'PARAKEET_EOU_START') return startDeferred.promise;
      return Promise.resolve({});
    });
    const { session, onUnavailable } = makeSession(transport, {
      maxRetainedAudioSecondsPerSource: 1.0,
    });
    const startPromise = session.start().catch(() => undefined);

    // 1 second at 8000Hz is 8000 samples. 2560 * 4 = 10,240 samples = 1.28s > 1.0s
    session.append('mic', new Float32Array(2_560 * 4));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_backpressure');
    expect(session.status()).toBe('unavailable');

    // Trying to append after exhaustion does not dispatch or resume
    session.append('mic', new Float32Array(2_560));
    startDeferred.resolve({});
    await startPromise;
    expect(session.status()).toBe('unavailable');
  });

  it('preflights oversized appends and fails with parakeet_backpressure before allocating past byte limit', async () => {
    const transport = makeTransport();
    const { session, onUnavailable } = makeSession(transport, {
      maxRetainedPcmBytes: 4096, // 4 KB limit (1024 Float32 samples)
    });
    await session.start();

    // 2560 Float32 samples = 10,240 bytes > 4096 bytes
    session.append('mic', new Float32Array(2_560));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_backpressure');
    expect(session.status()).toBe('unavailable');
  });

  it('bounds finish while startup is unresolved within timeout and fences listeners', async () => {
    const transport = makeTransport();
    const startDeferred = deferred<unknown>();
    transport.invoke = vi.fn((channel) => {
      if (channel === 'PARAKEET_EOU_START') return startDeferred.promise;
      return Promise.resolve({});
    });
    const { session, onUnavailable, onSegments } = makeSession(transport, {
      finishTimeoutMs: 50,
    });
    const startPromise = session.start().catch(() => undefined);
    session.append('mic', new Float32Array(2_560));

    // Finish while start is still unresolved
    await session.finish();

    expect(session.status()).toBe('unavailable');
    expect(onUnavailable).toHaveBeenCalledWith('parakeet_timeout');
    expect(transport.invoke).toHaveBeenCalledWith('PARAKEET_EOU_CANCEL', {
      meetingId: 'meeting-1',
      generation: 1,
      code: 'parakeet_timeout',
    });

    // Late start resolution must not restore ready status
    startDeferred.resolve({});
    await startPromise;
    expect(session.status()).toBe('unavailable');

    // Late update event must be fenced and ignored
    transport.emitUpdate({
      meetingId: 'meeting-1',
      generation: 1,
      event: {
        streamId: 'eou-meeting-1-mic',
        source: 'mic',
        generation: 1,
        revision: 1,
        processedAudioSeconds: 0.32,
        committedText: 'late text',
        tentativeText: '',
        tokens: [],
      },
    });
    expect(onSegments).not.toHaveBeenCalled();
  });

  it('forwards code: parakeet_cancelled when session.cancel is invoked', async () => {
    const transport = makeTransport();
    const { session, onUnavailable } = makeSession(transport);
    await session.start();

    session.cancel();

    expect(session.status()).toBe('unavailable');
    expect(onUnavailable).toHaveBeenCalledWith('parakeet_cancelled');
    expect(transport.invoke).toHaveBeenCalledWith('PARAKEET_EOU_CANCEL', {
      meetingId: 'meeting-1',
      generation: 1,
      code: 'parakeet_cancelled',
    });
  });
});
