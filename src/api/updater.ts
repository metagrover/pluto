import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../../electron/updateChecker';

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

export const applyUpdate = (): Promise<void> =>
  invoke<void>('PLUTO_UPDATER_APPLY_UPDATE');

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
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;
    getUpdateStatus().then((initial) => {
      if (mounted && initial) setStatus(initial);
    });

    const unsubscribe = subscribeToUpdateStatus((newStatus) => {
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
    setIsUpdating(true);
    try {
      await applyUpdate();
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    status,
    isChecking,
    isUpdating,
    checkNow: handleCheckNow,
    applyUpdate: handleApplyUpdate,
    openReleaseUrl,
  };
};
