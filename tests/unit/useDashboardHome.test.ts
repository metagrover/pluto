import { describe, expect, it, vi } from 'vitest';

import {
  createDashboardRefreshCoordinator,
  loadDashboardHomeData,
  transitionDashboardRefreshState,
} from '../../src/components/features/useDashboardHome';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeLoaders = () => ({
  getOverdueActionItems: vi.fn(async () => []),
  getStaleActionItems: vi.fn(async () => []),
  getActiveActionItems: vi.fn(async () => []),
  getAttentionAlerts: vi.fn(async () => []),
  getKnowledgeWorkspace: vi.fn(async () => null),
  listWorkingMemorySnapshots: vi.fn(async () => []),
  getKnowledgeGraphStats: vi.fn(async () => null),
});

describe('transitionDashboardRefreshState', () => {
  it('uses blocking loading only before the first resolved model', () => {
    expect(
      transitionDashboardRefreshState('start', {
        hasResolvedData: false,
      }),
    ).toEqual({ loading: true, refreshing: false });
  });

  it('keeps resolved content visible during background refreshes', () => {
    expect(
      transitionDashboardRefreshState('start', {
        hasResolvedData: true,
      }),
    ).toEqual({ loading: false, refreshing: true });
    expect(
      transitionDashboardRefreshState('settle', {
        hasResolvedData: true,
      }),
    ).toEqual({ loading: false, refreshing: false });
  });
});

describe('createDashboardRefreshCoordinator', () => {
  it('queues one trailing reload for callers arriving during an active reload', async () => {
    const reloadA = deferred<void>();
    const reloadB = deferred<void>();
    const reload = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(reloadA.promise)
      .mockReturnValueOnce(reloadB.promise);
    const refresh = createDashboardRefreshCoordinator(reload);

    const first = refresh();
    const second = refresh();
    const third = refresh();
    let secondSettled = false;
    void second.finally(() => {
      secondSettled = true;
    });

    await Promise.resolve();
    expect(second).not.toBe(first);
    expect(third).toBe(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(secondSettled).toBe(false);

    reloadA.resolve();
    await first;
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(secondSettled).toBe(false);

    reloadB.resolve();
    await second;
    expect(secondSettled).toBe(true);
  });

  it('runs the queued reload after an active failure and keeps their outcomes distinct', async () => {
    const reloadA = deferred<void>();
    const reloadB = deferred<void>();
    const reload = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(reloadA.promise)
      .mockReturnValueOnce(reloadB.promise);
    const refresh = createDashboardRefreshCoordinator(reload);

    const first = refresh();
    const queued = refresh();
    reloadA.reject(new Error('reload A failed'));

    await expect(first).rejects.toThrow('reload A failed');
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(2);

    reloadB.resolve();
    await expect(queued).resolves.toBeUndefined();
  });
});

describe('loadDashboardHomeData', () => {
  it.each([
    'getOverdueActionItems',
    'getStaleActionItems',
    'getActiveActionItems',
  ] as const)('rejects when required %s loading fails', async (loaderName) => {
    const loaders = makeLoaders();
    loaders[loaderName].mockRejectedValueOnce(new Error('action load failed'));

    await expect(loadDashboardHomeData(loaders)).rejects.toThrow(
      'action load failed',
    );
  });

  it('retains fallbacks when optional dashboard context fails', async () => {
    const loaders = makeLoaders();
    loaders.getKnowledgeWorkspace.mockRejectedValueOnce(
      new Error('workspace unavailable'),
    );
    loaders.getKnowledgeGraphStats.mockRejectedValueOnce(
      new Error('stats unavailable'),
    );

    await expect(loadDashboardHomeData(loaders)).resolves.toMatchObject({
      workspace: null,
      graphStats: null,
      overdueActions: [],
      staleActions: [],
      activeActions: [],
    });
  });
});
