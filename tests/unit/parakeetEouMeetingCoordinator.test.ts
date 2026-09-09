import { describe, expect, it, vi } from 'vitest';

import type { NativeEouUpdateEvent } from '../../electron/transcription/nativeJsonLineProcess';
import { ParakeetEouMeetingCoordinator } from '../../electron/transcription/parakeetEouMeetingCoordinator';

const makeClient = () => {
  let updateListener: ((event: NativeEouUpdateEvent) => void) | undefined;
  let failureListener: ((code: string) => void) | undefined;
  return {
    open: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    onUpdate: vi.fn((listener: (event: NativeEouUpdateEvent) => void) => {
      updateListener = listener;
      return () => {
        updateListener = undefined;
      };
    }),
    onTerminalFailure: vi.fn((listener: (code: string) => void) => {
      failureListener = listener;
      return () => {
        failureListener = undefined;
      };
    }),
    emitUpdate(event: NativeEouUpdateEvent) {
      updateListener?.(event);
    },
    emitFailure(code: string) {
      failureListener?.(code);
    },
  };
};

const makeCoordinator = (client = makeClient()) => {
  const onUpdate = vi.fn();
  const onUnavailable = vi.fn();
  const coordinator = new ParakeetEouMeetingCoordinator({
    createClient: async () => client,
    onUpdate,
    onUnavailable,
  });
  return { client, coordinator, onUpdate, onUnavailable };
};

const start = {
  meetingId: 'meeting-1',
  generation: 1,
  owner: 'renderer-7',
};

const audio = (source: 'mic' | 'system') => ({
  meetingId: 'meeting-1',
  source,
  sampleRate: 16_000,
  samples: new Float32Array(5_120),
  audioStartSeconds: 0,
  audioEndSeconds: 0.32,
});

describe('ParakeetEouMeetingCoordinator', () => {
  it('fences a cancelled pending creation and preserves the next meeting', async () => {
    const cancelledClient = makeClient();
    const nextClient = makeClient();
    let resolveCreation!: (client: ReturnType<typeof makeClient>) => void;
    const pendingCreation = new Promise<ReturnType<typeof makeClient>>(
      (resolve) => {
        resolveCreation = resolve;
      },
    );
    const createClient = vi
      .fn()
      .mockReturnValueOnce(pendingCreation)
      .mockResolvedValue(nextClient);
    const onUnavailable = vi.fn();
    const coordinator = new ParakeetEouMeetingCoordinator({
      createClient,
      onUnavailable,
      onUpdate: vi.fn(),
    });
    const pendingStart = coordinator.start(start);
    const rejectedStart =
      expect(pendingStart).rejects.toThrow('parakeet_cancelled');
    await expect(coordinator.start(start)).rejects.toThrow(
      'parakeet_meeting_active',
    );
    await coordinator.cancel('other-meeting');
    expect(onUnavailable).not.toHaveBeenCalled();
    await coordinator.cancel(start.meetingId);
    await coordinator.cancel(start.meetingId);
    await coordinator.start({
      ...start,
      meetingId: 'meeting-2',
      generation: 2,
    });
    resolveCreation(cancelledClient);
    await rejectedStart;
    expect(cancelledClient.open).not.toHaveBeenCalled();
    expect(cancelledClient.close).toHaveBeenCalledOnce();
    expect(nextClient.open).toHaveBeenCalledTimes(2);
    expect(nextClient.close).not.toHaveBeenCalled();
    expect(coordinator.isActive()).toBe(true);
    expect(onUnavailable).toHaveBeenCalledOnce();
    await coordinator.finish('meeting-2');
  });

  it('does not fail a newer meeting when an old cancelled open rejects', async () => {
    const oldClient = makeClient();
    const nextClient = makeClient();
    let rejectOpen!: (error: Error) => void;
    oldClient.open.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOpen = reject;
        }),
    );
    const createClient = vi
      .fn()
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValue(nextClient);
    const coordinator = new ParakeetEouMeetingCoordinator({
      createClient,
      onUnavailable: vi.fn(),
      onUpdate: vi.fn(),
    });
    const pending = coordinator.start(start);
    const rejected = expect(pending).rejects.toThrow('parakeet_cancelled');
    await vi.waitFor(() => expect(oldClient.open).toHaveBeenCalledTimes(2));
    await coordinator.cancel(start.meetingId);
    await coordinator.start({
      ...start,
      meetingId: 'meeting-2',
      generation: 2,
    });
    rejectOpen(new Error('old open failed'));
    await rejected;
    expect(nextClient.close).not.toHaveBeenCalled();
    expect(coordinator.isActive()).toBe(true);
    await coordinator.finish('meeting-2');
  });

  it('opens both English EOU sources under one meeting owner', async () => {
    const { coordinator, client } = makeCoordinator();

    await coordinator.start(start);

    expect(client.open).toHaveBeenCalledTimes(2);
    expect(client.open).toHaveBeenCalledWith({
      streamId: 'eou-meeting-1-mic',
      source: 'mic',
      generation: 1,
    });
    expect(client.open).toHaveBeenCalledWith({
      streamId: 'eou-meeting-1-system',
      source: 'system',
      generation: 1,
    });
  });

  it('assigns independent source sequences and rejects the wrong meeting', async () => {
    const { coordinator, client } = makeCoordinator();
    await coordinator.start(start);

    await coordinator.append(audio('mic'));
    await coordinator.append(audio('system'));
    await coordinator.append({
      ...audio('mic'),
      audioStartSeconds: 0.32,
      audioEndSeconds: 0.64,
    });

    expect(
      client.append.mock.calls.map(([request]) => [
        request.source,
        request.sequence,
      ]),
    ).toEqual([
      ['mic', 1],
      ['system', 1],
      ['mic', 2],
    ]);
    await expect(
      coordinator.append({ ...audio('system'), meetingId: 'meeting-2' }),
    ).rejects.toThrow('parakeet_meeting_mismatch');
  });

  it('forwards fenced updates with meeting and renderer ownership', async () => {
    const { coordinator, client, onUpdate } = makeCoordinator();
    await coordinator.start(start);
    const event: NativeEouUpdateEvent = {
      schemaVersion: 1,
      kind: 'event',
      event: 'eou_update',
      streamId: 'eou-meeting-1-system',
      source: 'system',
      generation: 1,
      revision: 1,
      processedAudioSeconds: 0.32,
      committedText: 'hello',
      tentativeText: 'world',
      tokens: [],
    };

    client.emitUpdate(event);

    expect(onUpdate).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      owner: 'renderer-7',
      event,
    });
  });

  it('drains both sources before closing the shared client', async () => {
    const { coordinator, client } = makeCoordinator();
    await coordinator.start(start);

    await coordinator.finish('meeting-1');

    expect(client.finish).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.close.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...client.finish.mock.invocationCallOrder),
    );
  });

  it('rolls back a partial open and reports unavailability exactly once', async () => {
    const client = makeClient();
    client.open.mockRejectedValueOnce(new Error('model unavailable'));
    const { coordinator, onUnavailable } = makeCoordinator(client);

    await expect(coordinator.start(start)).rejects.toThrow(
      'parakeet_live_unavailable',
    );

    expect(client.close).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      owner: 'renderer-7',
      code: 'parakeet_live_unavailable',
    });
  });

  it('reports client creation failure without exposing its underlying error', async () => {
    const onUnavailable = vi.fn();
    const coordinator = new ParakeetEouMeetingCoordinator({
      createClient: async () => {
        throw new Error('private runtime detail');
      },
      onUpdate: vi.fn(),
      onUnavailable,
    });

    await expect(coordinator.start(start)).rejects.toThrow(
      'parakeet_live_unavailable',
    );
    expect(onUnavailable).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      owner: 'renderer-7',
      code: 'parakeet_live_unavailable',
    });
  });

  it('fails closed once when either source or the client becomes terminal', async () => {
    const { coordinator, client, onUnavailable } = makeCoordinator();
    await coordinator.start(start);
    client.append.mockRejectedValueOnce(new Error('inference failed'));

    await expect(coordinator.append(audio('mic'))).rejects.toThrow(
      'parakeet_live_unavailable',
    );
    client.emitFailure('parakeet_inference_failed');
    await coordinator.fail('parakeet_repeated');

    expect(client.close).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(coordinator.isActive()).toBe(false);
  });

  it('cancels the active meeting and detaches listeners without error', async () => {
    const { coordinator, client, onUnavailable } = makeCoordinator();
    await coordinator.start(start);

    await coordinator.cancel('meeting-1');

    expect(client.close).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      owner: 'renderer-7',
      code: 'parakeet_cancelled',
    });
    expect(coordinator.isActive()).toBe(false);

    // Subsequent cancel is idempotent
    await coordinator.cancel('meeting-1');
    expect(client.close).toHaveBeenCalledOnce();
  });
});
