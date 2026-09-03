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
  getDashboardDateKey,
} from './dashboardModel';

export interface DashboardHomeState {
  model: DashboardHomeModel;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

interface DashboardRefreshContext {
  hasResolvedData: boolean;
}

export const transitionDashboardRefreshState = (
  event: 'start' | 'settle',
  context: DashboardRefreshContext,
): Pick<DashboardHomeState, 'loading' | 'refreshing'> =>
  event === 'start'
    ? {
        loading: !context.hasResolvedData,
        refreshing: context.hasResolvedData,
      }
    : { loading: false, refreshing: false };

interface DashboardHomeData {
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  attentionAlerts: AttentionItem[];
  workspace: KnowledgeWorkspacePayload | null;
  workingMemorySnapshots: WorkingMemorySnapshot[];
  graphStats: KnowledgeGraphStats | null;
  meetingPreviews: Array<
    Pick<Meeting, 'id'> &
      Partial<
        Pick<
          Meeting,
          | 'dashboard_detail'
          | 'recent_win_title'
          | 'recent_win_why'
          | 'recent_win_evidence'
          | 'recent_win_source'
        >
      >
  >;
}

interface DashboardHomeLoaders {
  getOverdueActionItems: () => Promise<Entity[]>;
  getStaleActionItems: () => Promise<Entity[]>;
  getActiveActionItems: () => Promise<Entity[]>;
  getAttentionAlerts: () => Promise<AttentionItem[]>;
  getKnowledgeWorkspace: () => Promise<KnowledgeWorkspacePayload | null>;
  listWorkingMemorySnapshots: () => Promise<WorkingMemorySnapshot[]>;
  getKnowledgeGraphStats: () => Promise<KnowledgeGraphStats | null>;
  getMeetingPreviews?: () => Promise<DashboardHomeData['meetingPreviews']>;
}

interface UseDashboardHomeParams {
  isRecording: boolean;
  meetings: Meeting[];
}

const buildEmptyDashboardHomeModel = (
  params: UseDashboardHomeParams,
  dateKey = getDashboardDateKey(),
): DashboardHomeModel =>
  buildDashboardHomeModel({
    ...params,
    dateKey,
    overdueActions: [],
    staleActions: [],
    activeActions: [],
    attentionAlerts: [],
    workspace: null,
    workingMemorySnapshots: [],
    graphStats: null,
  });

export const millisecondsUntilNextLocalDay = (now = new Date()): number => {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 0);
  return Math.max(1, nextDay.getTime() - now.getTime());
};

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
    meetingPreviews,
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
    loadOptional<DashboardHomeData['meetingPreviews']>(
      'meeting previews',
      loaders.getMeetingPreviews ?? (async () => []),
      [],
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
    meetingPreviews,
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
  const [dateKey, setDateKey] = useState(() => getDashboardDateKey());
  const [state, setState] = useState<
    DashboardHomeState & { hasResolvedData: boolean }
  >(() => ({
    model: buildEmptyDashboardHomeModel({ isRecording, meetings }, dateKey),
    loading: true,
    refreshing: false,
    hasResolvedData: false,
    error: null,
    refresh: async () => {},
  }));

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDateKey(getDashboardDateKey());
    }, millisecondsUntilNextLocalDay() + 50);
    return () => window.clearTimeout(timeout);
  }, [dateKey]);

  useEffect(() => {
    let cancelled = false;
    const refresh = createDashboardRefreshCoordinator(async () => {
      setState((previous) => ({
        ...previous,
        ...transitionDashboardRefreshState('start', previous),
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
          getMeetingPreviews: async () => {
            const previews = await window.ipcRenderer.invoke(
              'GET_DASHBOARD_MEETING_PREVIEWS',
            );
            return Array.isArray(previews)
              ? (previews as DashboardHomeData['meetingPreviews'])
              : [];
          },
        });

        if (cancelled) return;

        const previewsByMeeting = new Map(
          data.meetingPreviews.map((preview) => [String(preview.id), preview]),
        );
        const meetingsWithDashboardPreviews = meetings.map((meeting) => ({
          ...meeting,
          ...previewsByMeeting.get(String(meeting.id)),
        }));
        setState({
          model: buildDashboardHomeModel({
            isRecording,
            meetings: meetingsWithDashboardPreviews,
            dateKey,
            ...data,
          }),
          loading: false,
          refreshing: false,
          hasResolvedData: true,
          error: null,
          refresh,
        });
      } catch (error) {
        const loadError =
          error instanceof Error ? error : new Error('Dashboard load failed');
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            ...transitionDashboardRefreshState('settle', previous),
            error: loadError,
            refresh,
          }));
        }
        throw loadError;
      }
    });

    void refresh().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [dateKey, isRecording, meetings]);

  return {
    model: state.model,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    refresh: state.refresh,
  };
};
