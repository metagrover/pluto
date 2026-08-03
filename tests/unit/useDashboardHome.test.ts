import { describe, expect, it, vi } from 'vitest';

import {
  createDashboardRefreshCoordinator,
  loadDashboardHomeData,
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

describe('createDashboardRefreshCoordinator', () => {
  it('returns the active reload promise and keeps concurrent callers on the same reload', async () => {
    const reloadFinished = deferred<void>();
    const reload = vi.fn(() => reloadFinished.promise);
    const refresh = createDashboardRefreshCoordinator(reload);

    const first = refresh();
    const second = refresh();
    let settled = false;
    void first.finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    reloadFinished.resolve();
    await first;
    expect(settled).toBe(true);
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
