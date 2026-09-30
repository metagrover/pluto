import { describe, expect, it, vi } from 'vitest';
import {
  type LiveJournalAudio,
  createDurableEouSession,
} from '../../src/services/liveTranscription/durableEouSession';
import type { EouRendererTransport } from '../../src/services/liveTranscription/eouRendererSession';
import { createWavBlob } from '../../src/utils/audio';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
type Append = {
  generation: number;
  source: 'mic' | 'system';
  sequence: number;
  samples: Float32Array;
};
function transport(
  onAppend: (request: Append) => Promise<void> = async () => {},
) {
  const updates = new Set<(payload: unknown) => void>();
  const unavailable = new Set<(payload: unknown) => void>();
  const ipc: EouRendererTransport = {
    invoke: vi.fn(async (channel, payload) => {
      if (channel === 'PARAKEET_EOU_APPEND') await onAppend(payload as Append);
      return {};
    }),
    onUpdate: (listener) => {
      updates.add(listener);
      return () => updates.delete(listener);
    },
    onUnavailable: (listener) => {
      unavailable.add(listener);
      return () => unavailable.delete(listener);
    },
  };
  return {
    ...ipc,
    emit: (
      generation: number,
      tokens: Array<{ text: string; startSeconds: number; endSeconds: number }>,
    ) => {
      for (const listener of updates)
        listener({
          meetingId: 'recovery-fixture',
          generation,
          event: {
            streamId: 'eou-recovery-fixture-mic',
            source: 'mic',
            generation,
            revision: 1,
            processedAudioSeconds: tokens.at(-1)!.endSeconds,
            committedText: tokens.map((token) => token.text).join(' '),
            tentativeText: '',
            tokens: tokens.map((token) => ({ ...token, committed: true })),
          },
        });
    },
  };
}
async function journal(duration: number) {
  const data = new Uint8Array(
    await createWavBlob(
      new Float32Array(8000 * 2).fill(0.01),
      8000,
    ).arrayBuffer(),
  );
  const readAudio = vi.fn(
    async (
      _source: 'mic' | 'system',
      from: number,
    ): Promise<LiveJournalAudio> => {
      if (from >= duration - 0.000001)
        return { kind: 'waiting', latestEndSeconds: duration };
      const startSeconds = Math.floor(from / 2) * 2;
      return {
        kind: 'audio',
        data,
        startSeconds,
        endSeconds: startSeconds + 2,
        latestEndSeconds: duration,
      };
    },
  );
  return { readAudio, data };
}
const options = (
  ipc: EouRendererTransport,
  readAudio: Awaited<ReturnType<typeof journal>>['readAudio'],
) => ({
  meetingId: 'recovery-fixture',
  generation: 1,
  transport: ipc,
  readAudio,
  onSegments: vi.fn(),
  onStatus: vi.fn(),
  onUnavailable: vi.fn(),
  pollMs: 2,
  retryMs: 2,
  stallTimeoutMs: 100,
  startTimeoutMs: 100,
});

describe('durable live transcription', () => {
  it('replays unconfirmed speech before a later silence gap after restart', async () => {
    const stored = await journal(6);
    const readAudio = vi.fn(
      async (
        source: 'mic' | 'system',
        from: number,
      ): Promise<LiveJournalAudio> => {
        if (from >= 2 && from < 4)
          return { kind: 'gap', endSeconds: 4, latestEndSeconds: 6 };
        return stored.readAudio(source, from);
      },
    );
    const hung = deferred();
    const ipc = transport(async (request) => {
      if (request.generation === 1 && request.sequence >= 8)
        return hung.promise;
    });
    const config = options(ipc, readAudio);
    const session = createDurableEouSession({ ...config, stallTimeoutMs: 20 });
    await session.start();
    try {
      await vi.waitFor(() =>
        expect(
          readAudio.mock.calls.filter(([, from]) => from === 0).length,
        ).toBeGreaterThanOrEqual(4),
      );
      expect(config.onStatus).toHaveBeenCalledWith('reconnecting');
    } finally {
      hung.resolve();
      await session.cancel();
      await session.settled();
    }
  });

  it('leaves unread saved audio intact when the meeting ends during a stalled append', async () => {
    const stored = await journal(8);
    const before = stored.data.slice();
    const gate = deferred();
    const ipc = transport(() => gate.promise);
    const config = options(ipc, stored.readAudio);
    const session = createDurableEouSession({ ...config, finishTimeoutMs: 5 });
    await session.start();
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(ipc.invoke)
          .mock.calls.some(([channel]) => channel === 'PARAKEET_EOU_APPEND'),
      ).toBe(true),
    );
    await session.finish();
    await session.settled();
    gate.resolve();
    expect(stored.data).toEqual(before);
    expect(
      vi
        .mocked(ipc.invoke)
        .mock.calls.filter(([channel]) => channel === 'PARAKEET_EOU_START'),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(ipc.invoke)
        .mock.calls.every(([channel]) => channel.startsWith('PARAKEET_EOU_')),
    ).toBe(true);
  });
  it('catches up through more than the old 45-second limit with bounded reads and every sample in order', async () => {
    const stored = await journal(64);
    const gate = deferred();
    const samples = { mic: 0, system: 0 };
    const ipc = transport(async (request) => {
      await gate.promise;
      samples[request.source] += request.samples.length;
    });
    const config = options(ipc, stored.readAudio);
    const session = createDurableEouSession({
      ...config,
      stallTimeoutMs: 5000,
    });
    await session.start();
    try {
      await vi.waitFor(() => expect(stored.readAudio).toHaveBeenCalledTimes(2));
      expect(samples).toEqual({ mic: 0, system: 0 });
      expect(config.onStatus).toHaveBeenCalledWith('catching_up');
      gate.resolve();
      await vi.waitFor(
        () => expect(samples).toEqual({ mic: 64 * 8000, system: 64 * 8000 }),
        { timeout: 5000 },
      );
      expect(config.onUnavailable).not.toHaveBeenCalled();
      expect(config.onStatus).toHaveBeenLastCalledWith('active');
    } finally {
      await session.cancel();
      await session.settled();
    }
  });

  it('restarts a hung append, replays saved audio, keeps confirmed text and removes overlap without accepting stale events', async () => {
    const stored = await journal(8);
    const hung = deferred();
    const replayed = { mic: 0, system: 0 };
    const ipc = transport(async (request) => {
      if (
        request.generation === 1 &&
        request.source === 'mic' &&
        request.sequence === 4
      ) {
        ipc.emit(1, [{ text: 'alpha', startSeconds: 0.1, endSeconds: 1 }]);
      }
      if (request.generation === 1 && request.sequence >= 5)
        return hung.promise;
      if (request.generation === 2) {
        replayed[request.source] += request.samples.length;
        if (request.source === 'mic' && request.sequence === 4) {
          ipc.emit(2, [
            { text: 'alpha', startSeconds: 0.1, endSeconds: 1 },
            { text: 'beta', startSeconds: 1, endSeconds: 1.2 },
          ]);
          ipc.emit(1, [{ text: 'stale', startSeconds: 0, endSeconds: 3 }]);
        }
      }
    });
    const config = options(ipc, stored.readAudio);
    const session = createDurableEouSession({ ...config, stallTimeoutMs: 30 });
    await session.start();
    try {
      await vi.waitFor(() =>
        expect(replayed).toEqual({ mic: 8 * 8000, system: 8 * 8000 }),
      );
      const rows = config.onSegments.mock.calls.at(-1)![0];
      expect(rows.map((row: { rawText: string }) => row.rawText)).toEqual([
        'alpha',
        'beta',
      ]);
      expect(rows[0].id).toContain('eou:1:');
      expect(rows[1].id).toContain('eou:2:');
      expect(config.onStatus).toHaveBeenCalledWith('reconnecting');
      expect(config.onStatus).toHaveBeenLastCalledWith('active');
      expect(ipc.invoke).not.toHaveBeenCalledWith(
        'STOP_RECORDING',
        expect.anything(),
      );
    } finally {
      hung.resolve();
      await session.cancel();
      await session.settled();
    }
  });

  it('continues retrying after repeated failures and never calls a capture mutation', async () => {
    const stored = await journal(2);
    const ipc = transport(async () => {
      throw new Error('native_crashed');
    });
    const config = options(ipc, stored.readAudio);
    const session = createDurableEouSession(config);
    await session.start();
    await vi.waitFor(() =>
      expect(config.onUnavailable.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    await session.cancel();
    await session.settled();
    const starts = vi
      .mocked(ipc.invoke)
      .mock.calls.filter(
        ([channel]) => channel === 'PARAKEET_EOU_START',
      ).length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      vi
        .mocked(ipc.invoke)
        .mock.calls.filter(([channel]) => channel === 'PARAKEET_EOU_START'),
    ).toHaveLength(starts);
    expect(
      vi
        .mocked(ipc.invoke)
        .mock.calls.every(([channel]) => channel.startsWith('PARAKEET_EOU_')),
    ).toBe(true);
  });

  it('stops safely during pending startup and does not launch a replacement after finish', async () => {
    const stored = await journal(2);
    const gate = deferred();
    const ipc = transport();
    vi.mocked(ipc.invoke).mockImplementation(async (channel) => {
      if (channel === 'PARAKEET_EOU_START') await gate.promise;
      return {};
    });
    const config = options(ipc, stored.readAudio);
    const session = createDurableEouSession({ ...config, startTimeoutMs: 20 });
    await session.start();
    await session.cancel();
    gate.resolve();
    await session.settled();
    expect(stored.readAudio).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(ipc.invoke)
        .mock.calls.filter(([channel]) => channel === 'PARAKEET_EOU_START'),
    ).toHaveLength(1);
  });
});
