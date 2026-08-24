import type { AttentionItemStatus } from '../../../electron/intelligence/intelligenceTypes';
import type { Entity, EntityStatus } from '../../api/knowledgeGraph';

export const DASHBOARD_ACTION_COMPLETION_ERROR =
  'Could not update follow-up status. Try again.';
export const DASHBOARD_COMMITMENT_CREATION_ERROR =
  'Could not add commitment. Try again.';

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

export const persistDashboardCommitmentCreation = async (
  input: {
    text: string;
    dueDate: string | null;
  },
  deps: {
    upsertEntity: (entity: {
      type: 'action_item';
      name: string;
      status: EntityStatus;
      due_date: string | null;
      metadata: Record<string, unknown>;
      dedupe_by_name: boolean;
    }) => Promise<Entity>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<Entity> => {
  const text = input.text.trim();
  if (!text) throw new Error('Commitment text is required');

  const entity = await deps.upsertEntity({
    type: 'action_item',
    name: text,
    status: 'active',
    due_date: input.dueDate,
    dedupe_by_name: false,
    metadata: {
      commitment_state: 'confirmed',
      origin: 'user',
      created_from: 'dashboard',
      created_at: new Date().toISOString(),
    },
  });
  await deps.refreshDashboard();
  return entity;
};
