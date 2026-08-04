import { useEffect, useState } from 'react';
import type { AttentionItem } from '../../../electron/intelligence/intelligenceTypes';
import { getAttentionAlerts } from '../../api/intelligence';
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
import {
  type WorkingMemorySnapshot,
  listWorkingMemorySnapshots,
} from '../../api/workingMemory';
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

interface DashboardHomeData {
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  attentionAlerts: AttentionItem[];
  workspace: KnowledgeWorkspacePayload | null;
  workingMemorySnapshots: WorkingMemorySnapshot[];
  graphStats: KnowledgeGraphStats | null;
}

interface DashboardHomeLoaders {
  getOverdueActionItems: () => Promise<Entity[]>;
  getStaleActionItems: () => Promise<Entity[]>;
  getActiveActionItems: () => Promise<Entity[]>;
  getAttentionAlerts: () => Promise<AttentionItem[]>;
  getKnowledgeWorkspace: () => Promise<KnowledgeWorkspacePayload | null>;
  listWorkingMemorySnapshots: () => Promise<WorkingMemorySnapshot[]>;
  getKnowledgeGraphStats: () => Promise<KnowledgeGraphStats | null>;
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
    attentionAlerts: [],
    workspace: null,
    workingMemorySnapshots: [],
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

export const loadDashboardHomeData = async (
  loaders: DashboardHomeLoaders,
): Promise<DashboardHomeData> => {
  const [
    overdueActions,
    staleActions,
    activeActions,
    attentionAlerts,
    workspace,
    workingMemorySnapshots,
    graphStats,
  ] = await Promise.all([
    loaders.getOverdueActionItems(),
    loaders.getStaleActionItems(),
    loaders.getActiveActionItems(),
    loadOptional<AttentionItem[]>(
      'attention alerts',
      loaders.getAttentionAlerts,
      [],
    ),
    loadOptional<KnowledgeWorkspacePayload | null>(
      'knowledge workspace',
      loaders.getKnowledgeWorkspace,
      null,
    ),
    loadOptional<WorkingMemorySnapshot[]>(
      'working memory snapshots',
      loaders.listWorkingMemorySnapshots,
      [],
    ),
    loadOptional<KnowledgeGraphStats | null>(
      'graph stats',
      loaders.getKnowledgeGraphStats,
      null,
    ),
  ]);

  return {
    overdueActions,
    staleActions,
    activeActions,
    attentionAlerts,
    workspace,
    workingMemorySnapshots,
    graphStats,
  };
};

export const createDashboardRefreshCoordinator = (
  reload: () => Promise<void>,
): (() => Promise<void>) => {
  let activeRefresh: Promise<void> | null = null;
  let queuedRefresh: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;

  const finishActiveRefresh = () => {
    activeRefresh = null;
    const queued = queuedRefresh;
    queuedRefresh = null;
    if (queued) {
      startRefresh().then(queued.resolve, queued.reject);
    }
  };

  const startRefresh = (): Promise<void> => {
    const refresh = reload();
    activeRefresh = refresh;
    void refresh.then(finishActiveRefresh, finishActiveRefresh);
    return refresh;
  };

  return () => {
    if (!activeRefresh) return startRefresh();

    if (!queuedRefresh) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      queuedRefresh = { promise, resolve, reject };
    }

    return queuedRefresh.promise;
  };
};

export const useDashboardHome = ({
  isRecording,
  meetings,
}: UseDashboardHomeParams): DashboardHomeState => {
  const [state, setState] = useState<DashboardHomeState>(() => ({
    model: buildEmptyDashboardHomeModel({ isRecording, meetings }),
    loading: true,
    error: null,
    refresh: async () => {},
  }));

  useEffect(() => {
    let cancelled = false;
    const refresh = createDashboardRefreshCoordinator(async () => {
      setState((previous) => ({
        ...previous,
        loading: true,
        error: null,
        refresh,
      }));

      try {
        const data = await loadDashboardHomeData({
          getOverdueActionItems,
          getStaleActionItems: () => getStaleActionItems(7),
          getActiveActionItems: () => getActionItemsByStatus('active'),
          getAttentionAlerts,
          getKnowledgeWorkspace,
          listWorkingMemorySnapshots,
          getKnowledgeGraphStats,
        });

        if (cancelled) return;

        setState({
          model: buildDashboardHomeModel({
            isRecording,
            meetings,
            ...data,
          }),
          loading: false,
          error: null,
          refresh,
        });
      } catch (error) {
        const loadError =
          error instanceof Error ? error : new Error('Dashboard load failed');
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: loadError,
            refresh,
          }));
        }
        throw loadError;
      }
    });

    setState((previous) => ({
      model: previous.model,
      loading: true,
      error: null,
      refresh,
    }));

    void refresh().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isRecording, meetings]);

  return state;
};
