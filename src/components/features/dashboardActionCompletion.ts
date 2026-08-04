import type { AttentionItemStatus } from '../../../electron/intelligence/intelligenceTypes';
import type { EntityStatus } from '../../api/knowledgeGraph';

export const DASHBOARD_ACTION_COMPLETION_ERROR =
  'Could not update follow-up status. Try again.';

export class DashboardRefreshAfterMutationError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('The follow-up changed, but the dashboard could not refresh.');
    this.name = 'DashboardRefreshAfterMutationError';
    this.cause = cause;
  }
}

export const persistDashboardCommitmentReview = async (
  taskId: string,
  commitmentState: 'confirmed' | 'rejected',
  deps: {
    updateActionCommitmentState: (
      id: string,
      state: 'confirmed' | 'rejected',
    ) => Promise<unknown>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<void> => {
  await deps.updateActionCommitmentState(taskId, commitmentState);
  try {
    await deps.refreshDashboard();
  } catch (error) {
    throw new DashboardRefreshAfterMutationError(error);
  }
};

export const persistDashboardActionCompletion = async (
  taskId: string,
  deps: {
    updateEntityStatus: (id: string, status: EntityStatus) => Promise<unknown>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<void> => {
  await deps.updateEntityStatus(taskId, 'completed');
  await deps.refreshDashboard();
};

export const persistDashboardAttentionStatus = async (
  attentionItemId: string,
  status: AttentionItemStatus,
  deps: {
    updateAttentionStatus: (
      id: string,
      status: AttentionItemStatus,
    ) => Promise<unknown>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<void> => {
  await deps.updateAttentionStatus(attentionItemId, status);
  await deps.refreshDashboard();
};
