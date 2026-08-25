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
