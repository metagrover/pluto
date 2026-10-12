import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { createBeforeQuitHandler } from '../../electron/database/shutdown';
import { UpdateChecker } from '../../electron/updateChecker';

const selectedProfile = process.argv
  .find((arg) => arg.startsWith('--user-data-dir='))
  ?.slice('--user-data-dir='.length);
if (!selectedProfile) throw new Error('Isolated profile required');
app.setPath('userData', selectedProfile);
const profile = app.getPath('userData');
const config = JSON.parse(
  readFileSync(path.join(profile, 'fixture.json'), 'utf8'),
);
const report = (event: object) =>
  appendFileSync(
    path.join(profile, 'events.jsonl'),
    `${JSON.stringify(event)}\n`,
  );
// Only release transport and TCC are substituted; installation and app lifecycle are real.
process.env.PATH = `${config.bin}:${process.env.PATH}`;
process.env.PLUTO_TEST_ASSET = config.asset;
process.env.PLUTO_TEST_BAD_CHECKSUM = config.scenario === 'checksum' ? '1' : '';
let allowQuit = config.scenario !== 'blocked';
let retried = false;
app.on(
  'before-quit',
  createBeforeQuitHandler({
    canQuit: () => allowQuit,
    shutdownConsumers: async () => {},
    closeDatabase: () => {},
    quit: () => app.quit(),
    forceQuit: () => {
      report({ event: 'force-exit' });
      app.exit(0);
    },
  }),
);
void app
  .whenReady()
  .then(async () => {
    report({
      event: 'launched',
      version: app.getVersion(),
      packaged: app.isPackaged,
    });
    if (app.getVersion() === '1.0.0-rc.2') {
      const updater = new UpdateChecker(() => null);
      await updater.showPreviousUpdateFailure();
      report({
        event: 'complete',
        status: updater.getStatus(),
        sentinel: readFileSync(path.join(profile, 'pluto.db'), 'utf8'),
      });
      app.exit(0);
      return;
    }
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            tag_name: 'v1.0.0-rc.2',
            assets: [
              { name: 'SHA256SUMS.txt' },
              { name: 'Pluto-Mac-1.0.0-rc.2-Installer.dmg' },
            ],
          },
        ]),
        { status: 200 },
      );
    const window = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    const updater = new UpdateChecker(() => window);
    // Failure UI is exercised by DOM tests; avoid a modal halting this unattended fixture.
    const { dialog } = await import('electron');
    dialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
    });
    ipcMain.on('fixture-status', (_event, status) => {
      report({ event: 'status', update: status.update });
      if (status.update?.phase === 'failed' && !retried) {
        retried = true;
        report({
          event: 'retry',
          version: app.getVersion(),
          sentinel: readFileSync(path.join(profile, 'pluto.db'), 'utf8'),
        });
        allowQuit = true;
        process.env.PLUTO_TEST_BAD_CHECKSUM = '';
        setTimeout(() => {
          void clickTwice();
        }, 100);
      }
    });
    updater.start();
    await updater.checkForUpdates();
    await window.loadURL(
      'data:text/html,<title>Isolated Pluto updater acceptance</title>',
    );
    await window.webContents.executeJavaScript(
      `require('electron').ipcRenderer.on('pluto-updater:status-changed', (_event, status) => require('electron').ipcRenderer.send('fixture-status', status)); void 0;`,
    );
    if (config.scenario === 'renderer-veto') {
      await window.webContents.executeJavaScript(
        'window.onbeforeunload = () => false; void 0;',
      );
    }
    async function clickTwice() {
      const results = await window.webContents.executeJavaScript(
        `Promise.all([require('electron').ipcRenderer.invoke('PLUTO_UPDATER_APPLY_UPDATE'), require('electron').ipcRenderer.invoke('PLUTO_UPDATER_APPLY_UPDATE')])`,
      );
      report({ event: 'clicks', results });
    }
    await clickTwice();
    writeFileSync(path.join(profile, 'started'), String(process.pid));
  })
  .catch((error) => {
    report({ event: 'fixture-error', message: String(error) });
    app.exit(1);
  });
