import type { BrowserWindow, WebContents } from 'electron';

export function createNativeSettingsNavigation(options: {
  getWindow: () => BrowserWindow | null;
  createWindow: () => void;
  focusWindow: () => void;
}) {
  let ready = false;
  let pending:
    | 'PLUTO_NATIVE_MENU_OPEN_SETTINGS'
    | 'PLUTO_NATIVE_MENU_REPORT_PROBLEM'
    | null = null;

  const flush = () => {
    const window = options.getWindow();
    if (!pending || !ready || !window || window.isDestroyed()) return;
    const channel = pending;
    pending = null;
    window.webContents.send(channel);
  };

  return {
    open(
      channel:
        | 'PLUTO_NATIVE_MENU_OPEN_SETTINGS'
        | 'PLUTO_NATIVE_MENU_REPORT_PROBLEM' = 'PLUTO_NATIVE_MENU_OPEN_SETTINGS',
    ) {
      pending = channel;
      const window = options.getWindow();
      if (!window || window.isDestroyed()) options.createWindow();
      options.focusWindow();
      flush();
    },
    loading(contents: WebContents) {
      if (contents === options.getWindow()?.webContents) ready = false;
    },
    ready(contents: WebContents) {
      if (contents !== options.getWindow()?.webContents) return;
      ready = true;
      flush();
    },
  };
}
