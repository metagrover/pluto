export const BACKGROUND_KNOWLEDGE_QUIET_MS = 15 * 60 * 1_000;
export const BACKGROUND_KNOWLEDGE_RETRY_MS = 60 * 1_000;

export interface BackgroundKnowledgeRefreshPolicy {
  systemIdleSeconds: number;
  onBattery: boolean;
  thermalState: string;
  paused: boolean;
}

export interface BackgroundKnowledgeRefreshSnapshot {
  pendingMeetingIds: string[];
  activeMeetingId: string | null;
}

export const createBackgroundKnowledgeRefreshCoordinator = (options: {
  getPolicy: () => BackgroundKnowledgeRefreshPolicy;
  run: (meetingId: string, signal: AbortSignal) => Promise<void>;
  quietMs?: number;
  retryMs?: number;
  monitorMs?: number;
  // Resource-admitted work can continue through ordinary keyboard/mouse use.
  ignoreForegroundActivity?: boolean;
  now?: () => number;
  onError?: (error: unknown, meetingId: string) => void;
}) => {
  const quietMs = options.quietMs ?? BACKGROUND_KNOWLEDGE_QUIET_MS;
  const retryMs = options.retryMs ?? BACKGROUND_KNOWLEDGE_RETRY_MS;
  const monitorMs = options.monitorMs ?? 5_000;
  const now = options.now ?? Date.now;
  const pending = new Set<string>();
  let lastForegroundActivityAt = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: { meetingId: string; controller: AbortController } | undefined;
  let monitorTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (closed || pending.size === 0) return;
    clearTimer();
    timer = setTimeout(
      () => {
        timer = null;
        void attemptRun();
      },
      Math.max(0, delayMs),
    );
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  };

  const isEligible = () => {
    const policy = options.getPolicy();
    return (
      now() - lastForegroundActivityAt >= quietMs &&
      policy.systemIdleSeconds * 1_000 >= quietMs &&
      !policy.onBattery &&
      (policy.thermalState === 'nominal' || policy.thermalState === 'fair') &&
      !policy.paused
    );
  };

  async function attemptRun(): Promise<void> {
    if (closed || active || pending.size === 0) return;
    const quietRemaining =
      quietMs - Math.max(0, now() - lastForegroundActivityAt);
    if (quietRemaining > 0) {
      schedule(quietRemaining);
      return;
    }
    if (!isEligible()) {
      schedule(retryMs);
      return;
    }

    const meetingId = pending.values().next().value as string;
    const controller = new AbortController();
    active = { meetingId, controller };
    monitorTimer = setInterval(() => {
      if (!isEligible()) {
        controller.abort(
          new DOMException('Background capacity changed', 'AbortError'),
        );
      }
    }, monitorMs);
    if (typeof monitorTimer === 'object' && 'unref' in monitorTimer) {
      monitorTimer.unref();
    }
    let succeeded = false;
    try {
      await options.run(meetingId, controller.signal);
      succeeded = !controller.signal.aborted;
      if (succeeded) pending.delete(meetingId);
    } catch (error) {
      if (!controller.signal.aborted) options.onError?.(error, meetingId);
    } finally {
      if (monitorTimer) clearInterval(monitorTimer);
      monitorTimer = null;
      active = undefined;
      if (!closed && pending.size > 0 && !timer) {
        schedule(succeeded ? 0 : retryMs);
      }
    }
  }

  return {
    enqueue(meetingId: string) {
      if (closed || !meetingId) return;
      pending.add(meetingId);
      const quietRemaining =
        quietMs - Math.max(0, now() - lastForegroundActivityAt);
      schedule(Math.max(0, quietRemaining));
    },
    notifyForegroundActivity() {
      if (closed) return;
      if (options.ignoreForegroundActivity) return;
      lastForegroundActivityAt = now();
      active?.controller.abort(
        new DOMException('Foreground activity resumed', 'AbortError'),
      );
      if (pending.size > 0) schedule(quietMs);
    },
    snapshot(): BackgroundKnowledgeRefreshSnapshot {
      return {
        pendingMeetingIds: [...pending],
        activeMeetingId: active?.meetingId ?? null,
      };
    },
    close() {
      closed = true;
      clearTimer();
      if (monitorTimer) clearInterval(monitorTimer);
      monitorTimer = null;
      active?.controller.abort(
        new DOMException('Application shutting down', 'AbortError'),
      );
      active = undefined;
    },
  };
};

export type BackgroundKnowledgeRefreshCoordinator = ReturnType<
  typeof createBackgroundKnowledgeRefreshCoordinator
>;
