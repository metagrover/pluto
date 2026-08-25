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

    expect(onSegments).toHaveBeenCalledWith([
      expect.objectContaining({
        text: 'Final tail.',
        rawText: 'final tail',
        speaker: 'Speaker',
        confirmed: true,
      }),
    ]);
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
