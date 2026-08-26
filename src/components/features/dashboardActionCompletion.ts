import type { AttentionItemStatus } from '../../../electron/intelligence/intelligenceTypes';
import type { Entity, EntityStatus } from '../../api/knowledgeGraph';
import { parseActionMetadata } from '../../utils/actionCommitment';

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

export const persistDashboardPriorityOrder = async (
  input: {
    orderedIds: string[];
    previousIds: string[];
    dateKey: string;
  },
  deps: {
    getEntity: (id: string) => Promise<Entity | undefined>;
    upsertEntity: (entity: {
      id: string;
      type: 'action_item';
      name: string;
      status: EntityStatus;
      due_date: string | null;
      assigned_to: string | null;
      metadata: Record<string, unknown>;
      dedupe_by_name: false;
    }) => Promise<Entity>;
    refreshDashboard: () => Promise<void>;
  },
): Promise<void> => {
  const orderedIds = input.orderedIds.slice(0, 3);
  const affectedIds = Array.from(
    new Set([...input.previousIds, ...orderedIds]),
  );
  const entities = await Promise.all(
    affectedIds.map((id) => deps.getEntity(id)),
  );
  const writtenEntities: Entity[] = [];

  try {
    for (const entity of entities) {
      if (!entity || entity.type !== 'action_item') continue;
      const {
        dashboard_daily_priority: _previousPriority,
        ...metadataWithoutPriority
      } = parseActionMetadata(entity.metadata);
      const rank = orderedIds.indexOf(entity.id);
      const metadata =
        rank >= 0
          ? {
              ...metadataWithoutPriority,
              dashboard_daily_priority: { date: input.dateKey, rank },
            }
          : metadataWithoutPriority;
      await deps.upsertEntity({
        id: entity.id,
        type: 'action_item',
        name: entity.name,
        status: entity.status,
        due_date: entity.due_date,
        assigned_to: entity.assigned_to,
        metadata,
        dedupe_by_name: false,
      });
      writtenEntities.push(entity);
    }
  } catch (error) {
    for (const entity of writtenEntities.reverse()) {
      try {
        await deps.upsertEntity({
          id: entity.id,
          type: 'action_item',
          name: entity.name,
          status: entity.status,
          due_date: entity.due_date,
          assigned_to: entity.assigned_to,
          metadata: parseActionMetadata(entity.metadata),
          dedupe_by_name: false,
        });
      } catch {
        // Keep restoring the remaining snapshots before reconciliation.
      }
    }
    try {
      await deps.refreshDashboard();
    } catch {
      // Preserve the write failure while still attempting to reconcile the UI.
    }
    throw error;
  }

  await deps.refreshDashboard();
};
