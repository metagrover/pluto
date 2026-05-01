/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mic | mix | auto — overrides canonical full-session Whisper source */
  readonly VITE_PLUTO_CANONICAL_SOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PLUTO_BROWSER_PREVIEW__?: boolean;
  webkitAudioContext?: typeof AudioContext;
  ipcRenderer: {

    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;

    send: (channel: string, ...args: any[]) => void;
    on: (
      channel: string,

      listener: (event: unknown, ...args: any[]) => void,
    ) => void;

    off: (channel: string, listener: (...args: any[]) => void) => void;
  };
}
