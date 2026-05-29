import { useEffect, useState } from 'react';
import {
  type Entity,
  type KnowledgeGraphStats,
  getActionItemsByStatus,
  getKnowledgeGraphStats,
  getOverdueActionItems,
  getStaleActionItems,
} from '../../api/knowledgeGraph';
import {
  type KnowledgeWorkspacePayload,
  getKnowledgeWorkspace,
} from '../../api/knowledgeWorkspace';
import { getWorkingMemorySnapshot } from '../../api/workingMemory';
import type { Meeting } from '../../types';
import {
  type DashboardHomeModel,
  buildDashboardHomeModel,
} from './dashboardModel';

export interface DashboardHomeState {
  model: DashboardHomeModel;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

interface UseDashboardHomeParams {
  isRecording: boolean;
  meetings: Meeting[];
}

const buildEmptyDashboardHomeModel = (
  params: UseDashboardHomeParams,
): DashboardHomeModel =>
  buildDashboardHomeModel({
    ...params,
    overdueActions: [],
    staleActions: [],
    activeActions: [],
    workspace: null,
    workingMemorySnapshot: null,
    graphStats: null,
  });

const loadOptional = async <T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await loader();
  } catch (error) {
    console.error(`[Dashboard] Failed to load ${label}`, error);
    return fallback;
  }
};

export const useDashboardHome = ({
  isRecording,
  meetings,
}: UseDashboardHomeParams): DashboardHomeState => {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [state, setState] = useState<DashboardHomeState>(() => ({
    model: buildEmptyDashboardHomeModel({ isRecording, meetings }),
    loading: true,
    error: null,
    refresh: async () => {},
  }));

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [
        overdueActions,
        staleActions,
        activeActions,
        workspace,
        workingMemorySnapshot,
        graphStats,
      ] = await Promise.all([
        loadOptional<Entity[]>('overdue actions', getOverdueActionItems, []),
        loadOptional<Entity[]>(
          'stale actions',
          () => getStaleActionItems(7),
          [],
        ),
        loadOptional<Entity[]>(
          'active actions',
          () => getActionItemsByStatus('active'),
          [],
        ),
        loadOptional<KnowledgeWorkspacePayload | null>(
          'knowledge workspace',
          getKnowledgeWorkspace,
          null,
        ),
        loadOptional(
          'working memory snapshot',
          () => getWorkingMemorySnapshot('global', 'global'),
          undefined,
        ),
        loadOptional<KnowledgeGraphStats | null>(
          'graph stats',
          getKnowledgeGraphStats,
          null,
        ),
      ]);

      if (cancelled) return;

      setState({
        model: buildDashboardHomeModel({
          isRecording,
          meetings,
          overdueActions,
          staleActions,
          activeActions,
          workspace,
          workingMemorySnapshot: workingMemorySnapshot ?? null,
          graphStats,
        }),
        loading: false,
        error: null,
        refresh,
      });
    };

    setState((previous) => ({
      model: previous.model,
      loading: true,
      error: null,
      refresh,
    }));

    const loadDashboardHome = async () => {
      await refresh();
    };

    void loadDashboardHome();

    return () => {
      cancelled = true;
    };
  }, [isRecording, meetings, refreshNonce]);

  return {
    ...state,
    refresh: async () => {
      setRefreshNonce((previous) => previous + 1);
    },
  };
};
