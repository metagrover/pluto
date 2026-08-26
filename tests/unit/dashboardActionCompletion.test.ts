import { describe, expect, it, vi } from 'vitest';

import {
  DashboardRefreshAfterMutationError,
  persistDashboardActionCompletion,
  persistDashboardAttentionStatus,
  persistDashboardCommitmentCreation,
  persistDashboardCommitmentReview,
  persistDashboardPriorityOrder,
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

describe('persistDashboardPriorityOrder', () => {
  it('preserves entity metadata while ranking the daily three and clearing the displaced item', async () => {
    const entities = new Map([
      [
        'action-1',
        {
          id: 'action-1',
          type: 'action_item' as const,
          name: 'First',
          status: 'active' as const,
          due_date: null,
          assigned_to: null,
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        },
      ],
      [
        'action-2',
        {
          id: 'action-2',
          type: 'action_item' as const,
          name: 'Second',
          status: 'active' as const,
          due_date: null,
          assigned_to: null,
          metadata: JSON.stringify({
            commitment_state: 'confirmed',
            source_meeting_id: 'meeting-1',
          }),
        },
      ],
      [
        'action-3',
        {
          id: 'action-3',
          type: 'action_item' as const,
          name: 'Displaced',
          status: 'active' as const,
          due_date: null,
          assigned_to: null,
          metadata: JSON.stringify({
            commitment_state: 'confirmed',
            dashboard_daily_priority: { date: '2026-08-25', rank: 2 },
          }),
        },
      ],
    ]);
    const upsertEntity = vi.fn(async () => ({ id: 'saved' }));
    const refreshDashboard = vi.fn(async () => {});

    await persistDashboardPriorityOrder(
      {
        orderedIds: ['action-2', 'action-1'],
        previousIds: ['action-1', 'action-3'],
        dateKey: '2026-08-25',
      },
      {
        getEntity: vi.fn(async (id: string) => entities.get(id) as never),
        upsertEntity: upsertEntity as never,
        refreshDashboard,
      },
    );

    expect(upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'action-2',
        metadata: expect.objectContaining({
          source_meeting_id: 'meeting-1',
          dashboard_daily_priority: { date: '2026-08-25', rank: 0 },
        }),
      }),
    );
    expect(upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'action-1',
        metadata: expect.objectContaining({
          dashboard_daily_priority: { date: '2026-08-25', rank: 1 },
        }),
      }),
    );
    const displacedWrite = upsertEntity.mock.calls.find(
      ([entity]) => entity.id === 'action-3',
    )?.[0];
    expect(displacedWrite?.metadata).not.toHaveProperty(
      'dashboard_daily_priority',
    );
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
  });

  it('refreshes authoritative state when a priority write fails partway through', async () => {
    const entities = new Map(
      ['action-1', 'action-2'].map((id) => [
        id,
        {
          id,
          type: 'action_item' as const,
          name: id,
          status: 'active' as const,
          due_date: null,
          assigned_to: null,
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        },
      ]),
    );
    const writeFailure = new Error('second write failed');
    const upsertEntity = vi
      .fn()
      .mockResolvedValueOnce({ id: 'action-1' })
      .mockRejectedValueOnce(writeFailure)
      .mockResolvedValueOnce({ id: 'action-1' });
    const refreshDashboard = vi.fn(async () => {});

    await expect(
      persistDashboardPriorityOrder(
        {
          orderedIds: ['action-1', 'action-2'],
          previousIds: ['action-2', 'action-1'],
          dateKey: '2026-08-25',
        },
        {
          getEntity: vi.fn(async (id: string) => entities.get(id) as never),
          upsertEntity: upsertEntity as never,
          refreshDashboard,
        },
      ),
    ).rejects.toBe(writeFailure);

    expect(upsertEntity).toHaveBeenCalledTimes(3);
    expect(upsertEntity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'action-2',
        metadata: { commitment_state: 'confirmed' },
      }),
    );
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
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
