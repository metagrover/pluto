import type { BrowserWindow, WebContents } from 'electron';

export function createNativeSettingsNavigation(options: {
  getWindow: () => BrowserWindow | null;
  createWindow: () => void;
  focusWindow: () => void;
}) {
  let ready = false;
  let pending = false;

  const flush = () => {
    const window = options.getWindow();
    if (!pending || !ready || !window || window.isDestroyed()) return;
    pending = false;
    window.webContents.send('PLUTO_NATIVE_MENU_OPEN_SETTINGS');
  };

  return {
    open() {
      pending = true;
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
