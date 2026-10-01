import { describe, expect, it, vi } from 'vitest';
import {
  buildMacApplicationMenuTemplate,
  updateResultDialog,
} from '../../electron/macAppMenu';

describe('macOS application menu', () => {
  it('keeps native menus and routes Settings and update actions', () => {
    const openSettings = vi.fn();
    const checkForUpdates = vi.fn();
    const menu = buildMacApplicationMenuTemplate({
      openSettings,
      checkForUpdates,
    });
    expect(menu[0].label).toBe('Pluto');
    const appItems = menu[0].submenu as Electron.MenuItemConstructorOptions[];
    const settings = appItems.find((item) => item.label === 'Settings…');
    const updates = appItems.find(
      (item) => item.label === 'Check for Updates…',
    );
    expect(settings?.accelerator).toBe('Command+,');
    settings?.click?.(
      {} as Electron.MenuItem,
      {} as Electron.BrowserWindow,
      {} as Electron.KeyboardEvent,
    );
    updates?.click?.(
      {} as Electron.MenuItem,
      {} as Electron.BrowserWindow,
      {} as Electron.KeyboardEvent,
    );
    expect(openSettings).toHaveBeenCalledOnce();
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(menu.slice(1).map((item) => item.role)).toEqual([
      'fileMenu',
      'editMenu',
      'viewMenu',
      'windowMenu',
    ]);
    expect(appItems.map((item) => item.role).filter(Boolean)).toEqual([
      'about',
      'services',
      'hide',
      'hideOthers',
      'unhide',
      'quit',
    ]);
  });

  it('describes each update result without installing anything', () => {
    const base = { currentVersion: '0.1.0', checkedAt: 1 };
    expect(updateResultDialog({ ...base, hasUpdate: false })).toMatchObject({
      title: 'Pluto Is Up to Date',
      buttons: ['OK'],
    });
    expect(
      updateResultDialog({ ...base, hasUpdate: true, latestVersion: 'v0.2.0' }),
    ).toMatchObject({
      title: 'Pluto Update Available',
      buttons: ['Open Release Page', 'Later'],
    });
    expect(
      updateResultDialog({ ...base, hasUpdate: false, error: 'Offline' }),
    ).toMatchObject({
      title: 'Pluto Update Check',
      detail: 'Offline',
      buttons: ['OK'],
    });
  });
});
