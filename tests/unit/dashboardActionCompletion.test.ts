import { describe, expect, it, vi } from 'vitest';

import {
  DashboardRefreshAfterMutationError,
  persistDashboardActionCompletion,
  persistDashboardAttentionStatus,
  persistDashboardCommitmentCreation,
  persistDashboardCommitmentReview,
} from '../../src/components/features/dashboardActionCompletion';

describe('persistDashboardCommitmentReview', () => {
  it.each(['confirmed', 'rejected'] as const)(
    'persists a %s review before refreshing the dashboard',
    async (commitmentState) => {
      const calls: string[] = [];
      const updateActionCommitmentState = vi.fn(async () => {
        calls.push('update');
      });
      const refreshDashboard = vi.fn(async () => {
        calls.push('refresh');
      });

      await persistDashboardCommitmentReview('action-1', commitmentState, {
        updateActionCommitmentState,
        refreshDashboard,
      });

      expect(updateActionCommitmentState).toHaveBeenCalledWith(
        'action-1',
        commitmentState,
      );
      expect(refreshDashboard).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['update', 'refresh']);
    },
  );

  it.each(['confirmed', 'rejected'] as const)(
    'does not refresh when persisting a %s review fails',
    async (commitmentState) => {
      const updateActionCommitmentState = vi.fn(async () => {
        throw new Error('write failed');
      });
      const refreshDashboard = vi.fn();

      await expect(
        persistDashboardCommitmentReview('action-2', commitmentState, {
          updateActionCommitmentState,
          refreshDashboard,
        }),
      ).rejects.toThrow('write failed');

      expect(refreshDashboard).not.toHaveBeenCalled();
    },
  );

  it('distinguishes refresh failure after a durable commitment review', async () => {
    const updateActionCommitmentState = vi.fn(async () => {});
    const refreshDashboard = vi.fn(async () => {
      throw new Error('refresh failed');
    });

    await expect(
      persistDashboardCommitmentReview('action-3', 'confirmed', {
        updateActionCommitmentState,
        refreshDashboard,
      }),
    ).rejects.toBeInstanceOf(DashboardRefreshAfterMutationError);

    expect(updateActionCommitmentState).toHaveBeenCalledWith(
      'action-3',
      'confirmed',
    );
  });
});

describe('persistDashboardCommitmentCreation', () => {
  it('creates a confirmed user-authored action item before refreshing', async () => {
    const calls: string[] = [];
    const upsertEntity = vi.fn(async () => {
      calls.push('upsert');
      return { id: 'new-action' };
    });
    const refreshDashboard = vi.fn(async () => {
      calls.push('refresh');
    });

    await persistDashboardCommitmentCreation(
      {
        text: ' Send launch recap ',
        dueDate: '2026-04-30',
      },
      {
        upsertEntity: upsertEntity as never,
        refreshDashboard,
      },
    );

    expect(upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'action_item',
        name: 'Send launch recap',
        status: 'active',
        due_date: '2026-04-30',
        dedupe_by_name: false,
        metadata: expect.objectContaining({
          commitment_state: 'confirmed',
          origin: 'user',
          created_from: 'dashboard',
        }),
      }),
    );
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['upsert', 'refresh']);
  });

  it('rejects blank commitment text without writing', async () => {
    const upsertEntity = vi.fn();
    const refreshDashboard = vi.fn();

    await expect(
      persistDashboardCommitmentCreation(
        { text: '   ', dueDate: null },
        {
          upsertEntity: upsertEntity as never,
          refreshDashboard,
        },
      ),
    ).rejects.toThrow('Commitment text is required');

    expect(upsertEntity).not.toHaveBeenCalled();
    expect(refreshDashboard).not.toHaveBeenCalled();
  });
});

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

describe('persistDashboardAttentionStatus', () => {
  it('updates the linked attention item status before refreshing the dashboard', async () => {
    const calls: string[] = [];
    const updateAttentionStatus = vi.fn(async () => {
      calls.push('update');
    });
    const refreshDashboard = vi.fn(async () => {
      calls.push('refresh');
    });

    await persistDashboardAttentionStatus('attention-1', 'snoozed', {
      updateAttentionStatus,
      refreshDashboard,
    });

    expect(updateAttentionStatus).toHaveBeenCalledWith(
      'attention-1',
      'snoozed',
    );
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['update', 'refresh']);
  });

  it('does not refresh when the attention status update fails', async () => {
    const updateAttentionStatus = vi.fn(async () => {
      throw new Error('write failed');
    });
    const refreshDashboard = vi.fn();

    await expect(
      persistDashboardAttentionStatus('attention-2', 'dismissed', {
        updateAttentionStatus,
        refreshDashboard,
      }),
    ).rejects.toThrow('write failed');

    expect(refreshDashboard).not.toHaveBeenCalled();
  });
});
