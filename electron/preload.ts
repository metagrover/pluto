import { contextBridge, ipcRenderer } from 'electron';

const runtimePlatform = Object.freeze({
  platform:
    process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
      ? process.platform
      : 'unknown',
  arch:
    process.arch === 'arm64' || process.arch === 'x64'
      ? process.arch
      : 'unknown',
});

contextBridge.exposeInMainWorld('plutoRuntimePlatform', runtimePlatform);

type IpcListener = Parameters<typeof ipcRenderer.on>[1];

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    const wrapped: IpcListener = (event, ...eventArgs) =>
      listener(event, ...eventArgs);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args;
    return ipcRenderer.off(channel, listener);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },

  // You can expose other APTs you need here.
  // ...
});

contextBridge.exposeInMainWorld('plutoUpdater', {
  getStatus: () => ipcRenderer.invoke('PLUTO_UPDATER_GET_STATUS'),
  checkNow: () => ipcRenderer.invoke('PLUTO_UPDATER_CHECK_NOW'),
  applyUpdate: () => ipcRenderer.invoke('PLUTO_UPDATER_APPLY_UPDATE'),
  openReleaseUrl: (url?: string) =>
    ipcRenderer.invoke('PLUTO_UPDATER_OPEN_RELEASE_URL', url),
  onStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('pluto-updater:status-changed', handler);
    return () => ipcRenderer.off('pluto-updater:status-changed', handler);
  },
});
