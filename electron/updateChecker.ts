import { spawn } from 'node:child_process';
import { app, dialog, ipcMain, shell } from 'electron';
import { createLogger } from './logger';

const log = createLogger('UpdateChecker');

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  checkedAt: number;
  error?: string;
}

const GITHUB_REPO = 'metagrover/pluto';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_CHECK_DELAY_MS = 10 * 1000; // 10 seconds

/**
 * Compare semver strings (e.g. "0.2.0" vs "0.1.0").
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((num) => Number.parseInt(num, 10) || 0);
  const parts1 = parse(v1);
  const parts2 = parse(v2);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

export class UpdateChecker {
  private currentStatus: UpdateInfo;
  private intervalTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private getWindow: () => Electron.BrowserWindow | null;

  constructor(getWindow: () => Electron.BrowserWindow | null) {
    this.getWindow = getWindow;
    this.currentStatus = {
      hasUpdate: false,
      currentVersion: app.getVersion() || '0.1.0',
      checkedAt: Date.now(),
    };
  }

  public getStatus(): UpdateInfo {
    return this.currentStatus;
  }

  public async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion() || '0.1.0';
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: {
            'User-Agent': `Pluto-App/${currentVersion}`,
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const data = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
      };

      const latestTag = data.tag_name;
      const latestVersion = latestTag ? latestTag.replace(/^v/, '') : undefined;
      const hasUpdate = Boolean(
        latestVersion && compareVersions(latestVersion, currentVersion) > 0,
      );

      this.currentStatus = {
        hasUpdate,
        currentVersion,
        latestVersion: latestTag,
        releaseUrl:
          data.html_url || 'https://github.com/metagrover/pluto/releases',
        releaseNotes: data.body,
        checkedAt: Date.now(),
      };

      if (hasUpdate) {
        log.info('New update available', {
          current: currentVersion,
          latest: latestTag,
        });
      }

      this.broadcastStatus();
      return this.currentStatus;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('GitHub release check failed', {
        error: message,
      });
      this.currentStatus = {
        hasUpdate: false,
        currentVersion,
        checkedAt: Date.now(),
        error: message,
      };
      this.broadcastStatus();
      return this.currentStatus;
    }
  }

  public applyUpdate(): void {
    if (!app.isPackaged) {
      log.info('Update triggered in development mode');
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Pluto Update (Preview Mode)',
          message: 'Update script ready to execute!',
          detail:
            'In production, Pluto launches the detached background update script, replaces /Applications/Pluto.app, clears Gatekeeper quarantine flags, and restarts.\n\nCommand:\ncurl -fsSL https://raw.githubusercontent.com/metagrover/pluto/main/scripts/install.sh | bash',
          buttons: ['OK'],
        });
      }
      return;
    }

    log.info('Spawning detached update script and quitting application...');
    const updateCommand =
      'sleep 1 && curl -fsSL https://raw.githubusercontent.com/metagrover/pluto/main/scripts/install.sh | bash';
    const child = spawn('/bin/bash', ['-c', updateCommand], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    app.quit();
  }

  public start(): void {
    this.registerIpc();
    this.initialTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, INITIAL_CHECK_DELAY_MS);

    this.intervalTimer = setInterval(() => {
      void this.checkForUpdates();
    }, CHECK_INTERVAL_MS);
  }

  public stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  private broadcastStatus(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('pluto-updater:status-changed', this.currentStatus);
    }
  }

  private registerIpc(): void {
    ipcMain.handle('PLUTO_UPDATER_GET_STATUS', () => this.getStatus());
    ipcMain.handle('PLUTO_UPDATER_CHECK_NOW', () => this.checkForUpdates());
    ipcMain.handle('PLUTO_UPDATER_APPLY_UPDATE', () => {
      this.applyUpdate();
    });
    ipcMain.handle(
      'PLUTO_UPDATER_OPEN_RELEASE_URL',
      async (_event, url?: string) => {
        const targetUrl =
          url ||
          this.currentStatus.releaseUrl ||
          `https://github.com/${GITHUB_REPO}/releases/latest`;
        await shell.openExternal(targetUrl);
      },
    );
  }
}
