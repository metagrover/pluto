import { describe, expect, it, vi } from 'vitest';

import {
  ParakeetLiveMeetingCoordinator,
  type ShadowReceipt,
  descendantPids,
} from '../../electron/transcription/parakeetLiveMeetingCoordinator';

const receipt = (overrides: Partial<ShadowReceipt> = {}): ShadowReceipt => ({
  durable: true,
  meetingId: 'meeting-1',
  generation: 'generation-1',
  manifestRevision: 4,
  source: 'system',
  sequence: 0,
  checksumSha256: 'a'.repeat(64),
  chunkStartSec: 0,
  chunkEndSec: 5,
  repairAudioRelativePath: 'capture-journal/repair/system-000000.wav',
  ...overrides,
});

const safeResources = () => ({
  mlxRssBytes: 1,
  parakeetRssBytes: 1,
  electronRssBytes: 1,
  freePercent: 50,
  thermal: 'nominal' as const,
});

const makeClient = () => ({
  open: vi.fn(async () => {}),
  append: vi.fn(async () => {}),
  flush: vi.fn(async () => ({ finalPreview: '', degradations: [] })),
  cancel: vi.fn(async () => {}),
  close: vi.fn(async () => 'exited' as const),
});

const makeCoordinator = (overrides: Record<string, unknown> = {}) => {
  const client = makeClient();
  const dependencies = {
    enabled: () => true,
    createClient: async () => client,
    resolveRepairPath: (relativePath: string) => `/artifacts/${relativePath}`,
    sampleResources: safeResources,
    rollback: vi.fn(async () => true),
    stitchWindow: vi.fn(
      async ({ source }: { source: 'mic' | 'system' }) =>
        `/temporary/${source}.wav`,
    ),
    removeTemporaryAudio: vi.fn(async () => {}),
    writeReport: vi.fn(async () => {}),
    ...overrides,
  };
  return {
    client,
    dependencies,
    coordinator: new ParakeetLiveMeetingCoordinator(dependencies),
  };
};

const appendFullWindow = async (
  coordinator: ParakeetLiveMeetingCoordinator,
  source: 'mic' | 'system',
  meetingId = 'meeting-1',
) => {
  for (let sequence = 0; sequence < 6; sequence += 1) {
    await coordinator.append(
      receipt({
        meetingId,
        source,
        sequence,
        chunkStartSec: sequence * 5,
        chunkEndSec: sequence * 5 + 5,
        repairAudioRelativePath: `capture-journal/repair/${source}-${sequence}.wav`,
      }),
    );
  }
};

describe('ParakeetLiveMeetingCoordinator', () => {
  it('counts runtime descendants rather than only direct children', () => {
    expect(
      descendantPids(10, [
        { pid: 11, parentPid: 10 },
        { pid: 12, parentPid: 11 },
        { pid: 13, parentPid: 12 },
        { pid: 14, parentPid: 9 },
      ]),
    ).toEqual(new Set([11, 12, 13]));
  });

  it('opens independent mic and system streams and appends one full window per source', async () => {
    const { coordinator, client, dependencies } = makeCoordinator();
    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'mic');
    await appendFullWindow(coordinator, 'system');
    expect(client.open).toHaveBeenCalledWith({
      streamId: 'shadow-meeting-1-mic',
      source: 'mic',
      generation: 1,
    });
    expect(client.open).toHaveBeenCalledWith({
      streamId: 'shadow-meeting-1-system',
      source: 'system',
      generation: 1,
    });
    expect(client.append).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mic',
        sequence: 1,
        chunkStartSeconds: 0,
        chunkEndSeconds: 30,
      }),
    );
    expect(client.append).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        sequence: 1,
        chunkStartSeconds: 0,
        chunkEndSeconds: 30,
      }),
    );
    expect(dependencies.stitchWindow).toHaveBeenCalledTimes(2);
    expect(dependencies.removeTemporaryAudio).toHaveBeenCalledTimes(2);
  });

  it('submits both durable tails, flushes both streams, closes, then reports once', async () => {
    const { coordinator, client, dependencies } = makeCoordinator();
    await coordinator.start('meeting-1');
    await coordinator.append(receipt({ source: 'mic' }));
    await coordinator.append(receipt({ source: 'system' }));
    await coordinator.stop();
    expect(client.append).toHaveBeenCalledTimes(2);
    expect(client.flush).toHaveBeenCalledTimes(2);
    expect(dependencies.removeTemporaryAudio).toHaveBeenCalledTimes(2);
    expect(dependencies.writeReport).toHaveBeenCalledOnce();
    expect(
      dependencies.writeReport.mock.invocationCallOrder[0],
    ).toBeGreaterThan(client.close.mock.invocationCallOrder[0]!);
  });

  it('records a missing stitched WAV as a content-free source failure', async () => {
    const { coordinator, dependencies } = makeCoordinator({
      stitchWindow: vi.fn(async () => null),
    });
    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'mic');
    await coordinator.stop();
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'failed',
        failureCodes: expect.arrayContaining(['stitch_missing']),
      }),
    );
  });

  it('fences and cancels both streams after a source append failure', async () => {
    const client = makeClient();
    client.append.mockRejectedValueOnce(new Error('not exposed'));
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => client,
    });
    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'mic');
    expect(coordinator.isFenced()).toBe(true);
    expect(client.cancel).toHaveBeenCalledTimes(2);
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCodes: expect.arrayContaining(['append_failed']),
      }),
    );
  });

  it('fences resource denial before stitch and ignores late receipts', async () => {
    let samples = 0;
    const sampleResources = vi.fn(() =>
      samples++ === 0
        ? safeResources()
        : { ...safeResources(), thermal: 'serious' as const },
    );
    const { coordinator, client, dependencies } = makeCoordinator({
      sampleResources,
    });
    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'system');
    await coordinator.append(
      receipt({
        source: 'system',
        sequence: 6,
        chunkStartSec: 30,
        chunkEndSec: 35,
      }),
    );
    expect(coordinator.isFenced()).toBe(true);
    expect(client.append).not.toHaveBeenCalled();
    expect(dependencies.stitchWindow).not.toHaveBeenCalled();
    expect(dependencies.writeReport).toHaveBeenCalledOnce();
  });

  it('removes each stitched WAV exactly once after its append settles', async () => {
    const { coordinator, client, dependencies } = makeCoordinator();
    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'system');
    expect(client.append).toHaveBeenCalledOnce();
    expect(dependencies.removeTemporaryAudio).toHaveBeenCalledOnce();
    expect(
      dependencies.removeTemporaryAudio.mock.invocationCallOrder[0],
    ).toBeGreaterThan(client.append.mock.invocationCallOrder[0]!);
  });

  it('retains ownership and exposes uncertain cleanup after cancellation and rollback fail', async () => {
    const client = makeClient();
    client.close.mockResolvedValueOnce('cleanup_failed');
    let calls = 0;
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => client,
      rollback: vi.fn(async () => false),
      sampleResources: () => (calls++ === 0 ? safeResources() : undefined),
    });
    await coordinator.start('meeting-1');
    await expect(appendFullWindow(coordinator, 'system')).rejects.toThrow(
      'parakeet_shadow_uncertain_cleanup',
    );
    expect(client.cancel).toHaveBeenCalledTimes(2);
    expect(dependencies.writeReport).toHaveBeenCalledOnce();
    expect(coordinator.hasActiveClient()).toBe(true);
  });

  it('resets source ordinals and aggregate counters for a consecutive meeting', async () => {
    const firstClient = makeClient();
    const secondClient = makeClient();
    const createClient = vi
      .fn()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const { coordinator, dependencies } = makeCoordinator({ createClient });

    await coordinator.start('meeting-1');
    await appendFullWindow(coordinator, 'system');
    await coordinator.stop();
    await coordinator.start('meeting-2');
    await appendFullWindow(coordinator, 'system', 'meeting-2');
    await coordinator.stop();

    expect(secondClient.append).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 1 }),
    );
    expect(dependencies.writeReport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        windowsSubmitted: { mic: 0, system: 1 },
        windowsCompleted: { mic: 0, system: 1 },
        unresolved: { mic: 0, system: 0 },
      }),
    );
  });

  it('rolls back and reports when creating the client fails', async () => {
    const rollback = vi.fn(async () => true);
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => {
        throw new Error('not exposed');
      },
      rollback,
    });

    await coordinator.start('meeting-1');

    expect(rollback).toHaveBeenCalledOnce();
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'failed',
        failureCodes: expect.arrayContaining(['create_failed']),
      }),
    );
  });

  it('cancels, rolls back, and reports when opening the second stream fails', async () => {
    const client = makeClient();
    client.open
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not exposed'));
    const rollback = vi.fn(async () => true);
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => client,
      rollback,
    });

    await coordinator.start('meeting-1');

    expect(client.cancel).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledOnce();
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'failed',
        failureCodes: expect.arrayContaining(['open_failed']),
      }),
    );
  });

  it('cancels, rolls back, and reports when flushing a stream fails', async () => {
    const client = makeClient();
    client.flush.mockRejectedValueOnce(new Error('not exposed'));
    const rollback = vi.fn(async () => true);
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => client,
      rollback,
    });

    await coordinator.start('meeting-1');
    await coordinator.stop();

    expect(client.cancel).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledOnce();
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'failed',
        failureCodes: expect.arrayContaining(['flush_failed']),
      }),
    );
  });

  it('persists only a failed cleanup report when normal close fails', async () => {
    const client = makeClient();
    client.close.mockResolvedValueOnce('cleanup_failed');
    const { coordinator, dependencies } = makeCoordinator({
      createClient: async () => client,
    });

    await coordinator.start('meeting-1');
    await coordinator.stop();

    expect(dependencies.writeReport).toHaveBeenCalledOnce();
    expect(dependencies.writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'failed',
        failureCodes: expect.arrayContaining(['cleanup_uncertain']),
      }),
    );
  });
});
