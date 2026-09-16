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
  plutoRuntimePlatform?: Readonly<{
    platform: 'darwin' | 'linux' | 'win32' | 'unknown';
    arch: 'arm64' | 'x64' | 'unknown';
  }>;
  webkitAudioContext?: typeof AudioContext;
  ipcRenderer: {
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;

    send: (channel: string, ...args: any[]) => void;
    on: (
      channel: string,

      listener: (event: unknown, ...args: any[]) => void,
    ) => () => void;

    off: (channel: string, listener: (...args: any[]) => void) => void;
  };
  plutoUpdater?: {
    getStatus: () => Promise<import('../electron/updateChecker').UpdateInfo>;
    checkNow: () => Promise<import('../electron/updateChecker').UpdateInfo>;
    applyUpdate: () => Promise<void>;
    openReleaseUrl: (url?: string) => Promise<void>;
    onStatusChanged: (
      callback: (
        status: import('../electron/updateChecker').UpdateInfo,
      ) => void,
    ) => () => void;
  };
}
