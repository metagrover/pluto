import type { EntityStatus } from '../../api/knowledgeGraph';

export const DASHBOARD_ACTION_COMPLETION_ERROR =
  'Could not update follow-up status. Try again.';

export const persistDashboardActionCompletion = async (
  taskId: string,
  deps: {
    updateEntityStatus: (
      id: string,
      status: EntityStatus,
    ) => Promise<unknown>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<void> => {
  await deps.updateEntityStatus(taskId, 'completed');
  await deps.refreshDashboard();
};
