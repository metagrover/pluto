/// <reference types="vite/client" />

interface Window {
  webkitAudioContext?: typeof AudioContext;
  ipcRenderer: {
    invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ) => void;
    off: (channel: string, listener: (...args: unknown[]) => void) => void;
  };
}
