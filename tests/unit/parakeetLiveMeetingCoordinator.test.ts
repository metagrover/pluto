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
  sequence: 6,
  checksumSha256: 'a'.repeat(64),
  chunkStartSec: 10,
  chunkEndSec: 15,
  repairAudioRelativePath: 'meeting-1/capture-journal/repair/system-000006.wav',
  ...overrides,
});

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

  it('uses only durable system repair receipts and maps journal sequence plus one', async () => {
    const append = vi.fn(async () => {});
    const open = vi.fn(async () => {});
    const coordinator = new ParakeetLiveMeetingCoordinator({
      enabled: () => true,
      createClient: async () => ({
        open,
        append,
        close: async () => 'exited' as const,
      }),
      resolveRepairPath: (relativePath) => `/artifacts/${relativePath}`,
      sampleResources: () => ({
        mlxRssBytes: 1,
        parakeetRssBytes: 1,
        electronRssBytes: 1,
        freePercent: 50,
        thermal: 'nominal',
      }),
      rollback: async () => true,
    });

    await coordinator.start('meeting-1');
    await coordinator.append(receipt());
    await coordinator.append(receipt({ source: 'mic' }));
    await coordinator.append(receipt({ repairAudioRelativePath: null }));

    expect(open).toHaveBeenCalledWith({
      streamId: 'shadow-meeting-1-system',
      source: 'system',
      generation: 1,
    });
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith({
      streamId: 'shadow-meeting-1-system',
      source: 'system',
      generation: 1,
      sequence: 7,
      audioPath:
        '/artifacts/meeting-1/capture-journal/repair/system-000006.wav',
      chunkStartSeconds: 10,
      chunkEndSeconds: 15,
      checksumSha256: 'a'.repeat(64),
    });
  });

  it('fences later events, exits, and durably rolls back when combined memory breaches', async () => {
    const append = vi.fn(async () => {});
    const close = vi.fn(async () => 'exited' as const);
    const rollback = vi.fn(async () => true);
    let samples = 0;
    const coordinator = new ParakeetLiveMeetingCoordinator({
      enabled: () => true,
      createClient: async () => ({
        open: async () => {},
        append,
        close,
      }),
      resolveRepairPath: (relativePath) => `/artifacts/${relativePath}`,
      sampleResources: () => ({
        mlxRssBytes: samples++ < 2 ? 1 : 2 * 1024 ** 3,
        parakeetRssBytes: samples < 3 ? 1 : 2 * 1024 ** 3,
        electronRssBytes: samples < 3 ? 1 : 600 * 1024 ** 2,
        freePercent: 50,
        thermal: 'nominal',
      }),
      rollback,
    });

    await coordinator.start('meeting-1');
    await coordinator.append(receipt());
    await coordinator.append(receipt({ sequence: 7 }));

    expect(append).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(coordinator.isFenced()).toBe(true);
  });

  it('retains ownership and exposes uncertain cleanup until exit and rollback are proven', async () => {
    const close = vi.fn(async () => 'cleanup_failed' as const);
    const rollback = vi.fn(async () => false);
    let samples = 0;
    const coordinator = new ParakeetLiveMeetingCoordinator({
      enabled: () => true,
      createClient: async () => ({
        open: async () => {},
        append: async () => {},
        close,
      }),
      resolveRepairPath: (relativePath) => `/artifacts/${relativePath}`,
      sampleResources: () => ({
        mlxRssBytes: samples++ === 0 ? 1 : 3 * 1024 ** 3,
        parakeetRssBytes: 2 * 1024 ** 3,
        electronRssBytes: 1,
        freePercent: 50,
        thermal: 'nominal',
      }),
      rollback,
    });

    await coordinator.start('meeting-1');
    await expect(coordinator.append(receipt())).rejects.toThrow(
      'parakeet_shadow_uncertain_cleanup',
    );

    expect(close).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(coordinator.hasActiveClient()).toBe(true);
    expect(coordinator.isFenced()).toBe(true);
  });
});
