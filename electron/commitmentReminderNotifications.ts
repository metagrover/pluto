import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app } from 'electron';
import { commitmentReminderBody } from './commitmentReminderPolicy';
import type { ReminderAdapter } from './commitmentReminderScheduler';

export interface CommitmentNotificationBridge {
  /** Absent in older addons; local inference must refuse without this export. */
  memoryPressureSample?(): {
    wallTimeMs: number;
    memoryPressureFreePercent: number;
  };
  status(): Promise<string>;
  request(): Promise<string>;
  submit(
    id: string,
    title: string,
    body: string,
    entityId: string,
  ): Promise<string>;
  cancel(id: string): void;
  onClick(callback: (entityId: string) => void): void;
}

let initializedBridge: CommitmentNotificationBridge | null | undefined;
/** Install the native delegate before app readiness, buffering cold-launch clicks until DB unlock. */
export function initializeCommitmentNotificationBridge(): CommitmentNotificationBridge | null {
  if (initializedBridge !== undefined) return initializedBridge;
  initializedBridge = loadBridge();
  return initializedBridge;
}

function loadBridge(): CommitmentNotificationBridge | null {
  if (process.platform !== 'darwin') return null;
  try {
    const resources = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'resources');
    return createRequire(import.meta.url)(
      path.join(resources, 'bin', 'notification-bridge.node'),
    ) as CommitmentNotificationBridge;
  } catch {
    // Missing/unsupported native runtime never falls back to an unverified prompt.
    return null;
  }
}

async function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 10_000);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Immediate OS submission only. The encrypted ledger and main scheduler own timing. */
export function createCommitmentReminderNotifications(options: {
  getSetting(key: string): string | null | undefined;
  setSetting(key: string, value: string): void;
  onClick(entityId: string): void;
  bridge?: CommitmentNotificationBridge | null;
  now?: () => number;
  timeZone?: () => string;
}): ReminderAdapter {
  const bridge =
    options.bridge === undefined
      ? initializeCommitmentNotificationBridge()
      : options.bridge;
  const notificationIds = new Map<string, string>();
  const enabled = () =>
    options.getSetting('automaticCommitmentReminders') !== 'false';
  const now = options.now ?? Date.now;
  const timeZone =
    options.timeZone ??
    (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  bridge?.onClick((entityId) => {
    if (
      typeof entityId === 'string' &&
      entityId.length > 0 &&
      entityId.length <= 256
    )
      options.onClick(entityId);
  });
  return {
    async available() {
      if (!bridge || !enabled()) return false;
      try {
        let status = await bounded(bridge.status(), 'error');
        if (status === 'not-determined') {
          if (
            !enabled() ||
            options.getSetting('commitmentReminderPermissionRequested') ===
              'true'
          )
            return false;
          // Persist before prompting: a crash or denial must not trigger another prompt.
          options.setSetting('commitmentReminderPermissionRequested', 'true');
          status = await bounded(bridge.request(), 'error');
        }
        return status === 'authorized' && enabled();
      } catch {
        return false;
      }
    },
    async submit(candidate, reminder) {
      if (!bridge) return 'unsupported';
      if (!enabled()) return 'blocked';
      const id = `pluto-commitment-${createHash('sha256')
        .update(
          JSON.stringify([reminder.obligationId, reminder.deadlineRevision]),
        )
        .digest('hex')}`;
      notificationIds.set(reminder.obligationId, id);
      // Read the preview preference at dispatch, never store task text in the ledger.
      const body = commitmentReminderBody(
        candidate,
        now(),
        timeZone(),
        options.getSetting('commitmentReminderPreviews') === 'false',
      );
      try {
        const result = await bounded(
          bridge.submit(id, 'Pluto', body, candidate.id),
          'ambiguous',
        );
        return result === 'submitted' || result === 'failed'
          ? result
          : 'ambiguous';
      } catch {
        return 'ambiguous';
      }
    },
    cancel(obligationId) {
      const id = notificationIds.get(obligationId);
      if (!id) return;
      notificationIds.delete(obligationId);
      try {
        bridge?.cancel(id);
      } catch {
        /* Cancellation is best effort; delivery history remains durable. */
      }
    },
  };
}
