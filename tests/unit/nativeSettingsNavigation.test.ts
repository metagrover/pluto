import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createNativeSettingsNavigation } from '../../electron/nativeSettingsNavigation';

const fakeWindow = () => ({
  isDestroyed: vi.fn(() => false),
  webContents: { send: vi.fn() },
});

describe('native Settings navigation', () => {
  it('opens an existing ready window exactly once per command', () => {
    const window = fakeWindow();
    const focusWindow = vi.fn();
    const navigation = createNativeSettingsNavigation({
      getWindow: () => window as unknown as BrowserWindow,
      createWindow: vi.fn(),
      focusWindow,
    });
    navigation.ready(window.webContents as unknown as Electron.WebContents);
    navigation.open();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledWith(
      'PLUTO_NATIVE_MENU_OPEN_SETTINGS',
    );
  });

  it('holds a command until the reopened window renderer is ready', () => {
    const oldWindow = fakeWindow();
    oldWindow.isDestroyed.mockReturnValue(true);
    let current: ReturnType<typeof fakeWindow> | null = oldWindow;
    const createWindow = vi.fn(() => {
      current = fakeWindow();
    });
    const navigation = createNativeSettingsNavigation({
      getWindow: () => current as unknown as BrowserWindow,
      createWindow,
      focusWindow: vi.fn(),
    });
    navigation.open();
    expect(createWindow).toHaveBeenCalledOnce();
    expect(current?.webContents.send).not.toHaveBeenCalled();
    navigation.ready(oldWindow.webContents as unknown as Electron.WebContents);
    expect(current?.webContents.send).not.toHaveBeenCalled();
    navigation.ready(current?.webContents as unknown as Electron.WebContents);
    expect(current?.webContents.send).toHaveBeenCalledOnce();
  });

  it('waits again while a window reloads', () => {
    const window = fakeWindow();
    const navigation = createNativeSettingsNavigation({
      getWindow: () => window as unknown as BrowserWindow,
      createWindow: vi.fn(),
      focusWindow: vi.fn(),
    });
    navigation.ready(window.webContents as unknown as Electron.WebContents);
    navigation.loading(window.webContents as unknown as Electron.WebContents);
    navigation.open();
    expect(window.webContents.send).not.toHaveBeenCalled();
    navigation.ready(window.webContents as unknown as Electron.WebContents);
    expect(window.webContents.send).toHaveBeenCalledOnce();
  });
});
