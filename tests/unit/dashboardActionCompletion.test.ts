import { describe, expect, it, vi } from 'vitest';

import { persistDashboardActionCompletion } from '../../src/components/features/dashboardActionCompletion';

describe('persistDashboardActionCompletion', () => {
  it('marks the action completed before refreshing the dashboard', async () => {
    const calls: string[] = [];
    const updateEntityStatus = vi.fn(async () => {
      calls.push('update');
    });
    const refreshDashboard = vi.fn(async () => {
      calls.push('refresh');
    });

    await persistDashboardActionCompletion('action-1', {
      updateEntityStatus,
      refreshDashboard,
    });

    expect(updateEntityStatus).toHaveBeenCalledWith('action-1', 'completed');
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['update', 'refresh']);
  });

  it('does not refresh when the status update fails', async () => {
    const updateEntityStatus = vi.fn(async () => {
      throw new Error('write failed');
    });
    const refreshDashboard = vi.fn();

    await expect(
      persistDashboardActionCompletion('action-2', {
        updateEntityStatus,
        refreshDashboard,
      }),
    ).rejects.toThrow('write failed');

    expect(refreshDashboard).not.toHaveBeenCalled();
  });
});
