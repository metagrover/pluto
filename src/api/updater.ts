import { useEffect, useRef, useState } from 'react';
import type {
  UpdateApplyResult,
  UpdateInfo,
} from '../../electron/updateChecker';

export type { UpdateInfo };

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  if (typeof window === 'undefined' || !window.ipcRenderer) {
    return Promise.resolve({
      hasUpdate: false,
      currentVersion: '0.1.0',
      checkedAt: Date.now(),
    } as unknown as T);
  }
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getUpdateStatus = (): Promise<UpdateInfo> =>
  invoke<UpdateInfo>('PLUTO_UPDATER_GET_STATUS');

export const checkForUpdates = (): Promise<UpdateInfo> =>
  invoke<UpdateInfo>('PLUTO_UPDATER_CHECK_NOW');

export const applyUpdate = (): Promise<UpdateApplyResult> => {
  if (typeof window === 'undefined' || !window.ipcRenderer) {
    return Promise.resolve({
      started: false,
      error: 'Update controls are unavailable. Restart Pluto and try again.',
    });
  }
  return invoke<UpdateApplyResult>('PLUTO_UPDATER_APPLY_UPDATE');
};

export const openReleaseUrl = (url?: string): Promise<void> =>
  invoke<void>('PLUTO_UPDATER_OPEN_RELEASE_URL', url);

export const subscribeToUpdateStatus = (
  callback: (status: UpdateInfo) => void,
): (() => void) => {
  if (
    typeof window === 'undefined' ||
    typeof window.ipcRenderer?.on !== 'function'
  ) {
    return () => {};
  }
  return window.ipcRenderer.on(
    'pluto-updater:status-changed',
    (_event, status: UpdateInfo) => {
      callback(status);
    },
  );
};

export const useAppUpdate = () => {
  const [status, setStatus] = useState<UpdateInfo>({
    hasUpdate: false,
    currentVersion: '0.1.0',
    checkedAt: Date.now(),
  });
  const [isChecking, setIsChecking] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const requestRef = useRef(false);
  const activePhase = status.update?.phase;
  const isUpdating =
    requestPending ||
    (!!activePhase && activePhase !== 'failed' && activePhase !== 'complete');
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let receivedStatus = false;
    getUpdateStatus()
      .then((initial) => {
        if (mounted && !receivedStatus && initial) setStatus(initial);
      })
      .catch(() => {});

    const unsubscribe = subscribeToUpdateStatus((newStatus) => {
      receivedStatus = true;
      if (mounted) setStatus(newStatus);
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      const result = await checkForUpdates();
      setStatus(result);
    } finally {
      setIsChecking(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (requestRef.current || isUpdating) return;
    requestRef.current = true;
    setUpdateError(null);
    setRequestPending(true);
    try {
      const result = await applyUpdate();
      if (!result.started) setUpdateError(result.error);
      else setStatus(await getUpdateStatus());
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      requestRef.current = false;
      setRequestPending(false);
    }
  };

  return {
    status,
    isChecking,
    isUpdating,
    updateError:
      status.update?.phase === 'failed' ? status.update.message : updateError,
    checkNow: handleCheckNow,
    applyUpdate: handleApplyUpdate,
    openReleaseUrl,
  };
};
