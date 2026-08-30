import type { CalendarStore } from './store';
import type {
  CalendarAuthorizationStatus,
  CalendarCapabilityState,
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from './types';

export interface CalendarNativeClient {
  authorizationStatus(): Promise<CalendarAuthorizationStatus>;
  requestAccess(): Promise<CalendarAuthorizationStatus>;
  listCalendars(): Promise<CalendarDescriptor[]>;
  listEvents(
    calendarIdentifier: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]>;
  onChange(listener: () => void): () => void;
  close(): void;
}

type CalendarStorePort = Pick<
  CalendarStore,
  | 'getState'
  | 'selectCalendar'
  | 'replaceEvents'
  | 'listEvents'
  | 'recordFailure'
  | 'disconnect'
>;

const authorizationState = (
  authorization: CalendarAuthorizationStatus,
): CalendarCapabilityState => {
  if (authorization === 'full_access') return 'needs_selection';
  return authorization;
};

export const createCalendarService = (deps: {
  platform: NodeJS.Platform;
  runtimeAvailable: () => boolean;
  client: CalendarNativeClient;
  store: CalendarStorePort;
  now?: () => Date;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) => {
  const now = deps.now ?? (() => new Date());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  let generation = 0;
  let refreshPromise: Promise<void> | null = null;
  let stopChangeListener: (() => void) | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;

  const capability = (): CalendarCapabilityState | null => {
    if (deps.platform !== 'darwin') return 'unsupported_platform';
    if (!deps.runtimeAvailable()) return 'runtime_missing';
    return null;
  };

  const snapshotFor = async (
    authorizationOverride?: CalendarAuthorizationStatus,
  ): Promise<CalendarIntegrationSnapshot> => {
    const unavailable = capability();
    const persisted = deps.store.getState();
    if (unavailable) {
      return {
        state: unavailable,
        authorization: 'restricted',
        enabled: false,
        selectedCalendar: null,
        calendars: [],
        lastAttemptAt: persisted.lastAttemptAt,
        lastReadAt: persisted.lastReadAt,
        cacheStart: persisted.cacheStart,
        cacheEnd: persisted.cacheEnd,
        stale: false,
      };
    }
    const authorization =
      authorizationOverride ?? (await deps.client.authorizationStatus());
    let calendars: CalendarDescriptor[] = [];
    if (authorization === 'full_access') {
      calendars = await deps.client.listCalendars();
    }
    let state = authorizationState(authorization);
    if (authorization === 'full_access') {
      if (!calendars.length) state = 'no_calendars';
      else if (
        persisted.selectedCalendar &&
        !calendars.some(
          (calendar) =>
            calendar.identifier === persisted.selectedCalendar?.identifier,
        )
      ) {
        state = 'selected_calendar_missing';
      } else if (persisted.enabled && persisted.selectedCalendar) {
        state = persisted.errorCode ?? 'ready';
      }
    }
    return {
      state,
      authorization,
      enabled: persisted.enabled,
      selectedCalendar: persisted.selectedCalendar,
      calendars,
      lastAttemptAt: persisted.lastAttemptAt,
      lastReadAt: persisted.lastReadAt,
      cacheStart: persisted.cacheStart,
      cacheEnd: persisted.cacheEnd,
      stale: state === 'read_failed' && Boolean(persisted.lastReadAt),
    };
  };

  const refresh = (): Promise<void> => {
    if (refreshPromise) return refreshPromise;
    const runGeneration = generation;
    const state = deps.store.getState();
    if (!state.enabled || !state.selectedCalendar) return Promise.resolve();
    const readAt = now();
    const start = new Date(readAt);
    start.setDate(start.getDate() - 14);
    const end = new Date(readAt);
    end.setDate(end.getDate() + 30);
    const nextRevision = state.cacheRevision + 1;
    refreshPromise = deps.client
      .listEvents(
        state.selectedCalendar.identifier,
        start.toISOString(),
        end.toISOString(),
      )
      .then((events) => {
        if (runGeneration !== generation) return;
        deps.store.replaceEvents({
          calendarIdentifier: state.selectedCalendar!.identifier,
          revision: nextRevision,
          cacheStart: start.toISOString(),
          cacheEnd: end.toISOString(),
          readAt: readAt.toISOString(),
          events,
        });
      })
      .catch((error) => {
        if (runGeneration === generation) {
          deps.store.recordFailure('read_failed', readAt.toISOString());
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const connect = async () => {
    const unavailable = capability();
    if (unavailable) return snapshotFor();
    start();
    const authorization = await deps.client.requestAccess();
    return snapshotFor(authorization);
  };

  const selectCalendar = async (calendar: CalendarDescriptor) => {
    const calendars = await deps.client.listCalendars();
    const current = calendars.find(
      (candidate) => candidate.identifier === calendar.identifier,
    );
    if (!current) throw new Error('selected_calendar_missing');
    generation += 1;
    deps.store.selectCalendar(current);
    await refresh();
    return snapshotFor('full_access');
  };

  const listDay = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate >= endDate ||
      endDate.getTime() - startDate.getTime() > 48 * 60 * 60 * 1000
    ) {
      throw new Error('invalid_calendar_day');
    }
    return deps.store
      .listEvents(start, end)
      .filter((event) => !event.isAllDay && !event.isCancelled);
  };

  function start() {
    if (stopChangeListener || capability()) return;
    stopChangeListener = deps.client.onChange(() => {
      if (changeTimer) clearTimer(changeTimer);
      changeTimer = setTimer(() => {
        changeTimer = null;
        void refresh().catch(() => undefined);
      }, 750);
    });
    if (deps.store.getState().enabled) {
      void refresh().catch(() => undefined);
    }
  }

  const stop = () => {
    generation += 1;
    if (changeTimer) clearTimer(changeTimer);
    changeTimer = null;
    stopChangeListener?.();
    stopChangeListener = null;
    deps.client.close();
  };

  const disconnect = () => {
    stop();
    deps.store.disconnect();
  };

  return {
    getSnapshot: snapshotFor,
    connect,
    selectCalendar,
    refresh,
    listDay,
    start,
    stop,
    disconnect,
  };
};

export type CalendarService = ReturnType<typeof createCalendarService>;
