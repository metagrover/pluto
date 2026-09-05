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

const makeSession = (transport = makeTransport()) => {
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
    }),
  };
};

describe('EOU renderer session', () => {
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

  it('fails unavailable once at four outstanding frames without stopping capture', async () => {
    const transport = makeTransport();
    const blocked = deferred<unknown>();
    transport.invoke = vi.fn((channel) =>
      channel === 'PARAKEET_EOU_APPEND' ? blocked.promise : Promise.resolve({}),
    );
    const { session, onUnavailable } = makeSession(transport);
    await session.start();

    session.append('mic', new Float32Array(2_560 * 5));
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
    session.append('system', new Float32Array(2_560));

    expect(onUnavailable).toHaveBeenCalledWith('parakeet_backpressure');
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
});
