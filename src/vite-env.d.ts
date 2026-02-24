/// <reference types="vite/client" />

interface Window {
  webkitAudioContext?: typeof AudioContext;
  ipcRenderer: {
    // biome-ignore lint/suspicious/noExplicitAny: IPC payloads are dynamic across channels.
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;
    // biome-ignore lint/suspicious/noExplicitAny: IPC payloads are dynamic across channels.
    send: (channel: string, ...args: any[]) => void;
    on: (
      channel: string,
      // biome-ignore lint/suspicious/noExplicitAny: IPC payloads are dynamic across channels.
      listener: (event: unknown, ...args: any[]) => void,
    ) => void;
    // biome-ignore lint/suspicious/noExplicitAny: IPC payloads are dynamic across channels.
    off: (channel: string, listener: (...args: any[]) => void) => void;
  };
}
