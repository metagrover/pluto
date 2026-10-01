import type { MenuItemConstructorOptions, MessageBoxOptions } from 'electron';
import type { UpdateInfo } from './updateChecker';

export const buildMacApplicationMenuTemplate = (actions: {
  openSettings: () => void;
  checkForUpdates: () => void;
}): MenuItemConstructorOptions[] => [
  {
    label: 'Pluto',
    submenu: [
      { role: 'about', label: 'About Pluto' },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'Command+,',
        click: actions.openSettings,
      },
      { label: 'Check for Updates…', click: actions.checkForUpdates },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
];

export const updateResultDialog = (status: UpdateInfo): MessageBoxOptions => {
  if (status.error) {
    return {
      type: 'error',
      title: 'Pluto Update Check',
      message: 'Pluto could not check for updates.',
      detail: status.error,
      buttons: ['OK'],
    };
  }
  if (status.hasUpdate) {
    return {
      type: 'info',
      title: 'Pluto Update Available',
      message: `${status.latestVersion ?? 'A new version'} of Pluto is available.`,
      detail: `You are using Pluto ${status.currentVersion}.`,
      buttons: ['Open Release Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
  }
  return {
    type: 'info',
    title: 'Pluto Is Up to Date',
    message: `Pluto ${status.currentVersion} is up to date.`,
    buttons: ['OK'],
  };
};
