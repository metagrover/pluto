import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import { INSTALLER_URL } from '../src/utils/plutoInstaller';
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

// Release workflow supports stable versions and RCs (including legacy .rc tags).
function parseVersion(version: string): number[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-.]rc\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`Unsupported release version: ${version}`);
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4]),
  ];
}

export function compareVersions(v1: string, v2: string): number {
  const first = parseVersion(v1);
  const second = parseVersion(v2);
  for (let i = 0; i < first.length; i++) {
    if (first[i] > second[i]) return 1;
    if (first[i] < second[i]) return -1;
  }
  return 0;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  assets?: { name: string }[];
}

export function newestInstallableRelease(
  releases: GitHubRelease[],
): GitHubRelease | undefined {
  return releases
    .filter((release) => {
      if (release.draft || !release.tag_name) return false;
      try {
        parseVersion(release.tag_name);
      } catch {
        return false;
      }
      const version = release.tag_name
        .replace(/^v/, '')
        .replace('.rc.', '-rc.');
      const names = release.assets?.map((asset) => asset.name) ?? [];
      return (
        names.includes('SHA256SUMS.txt') &&
        names.includes(`Pluto-Mac-${version}-Installer.dmg`)
      );
    })
    .sort((a, b) => compareVersions(b.tag_name!, a.tag_name!))[0];
}

// A detached shell survives Electron shutdown. It never replaces a running app.
// On failure, reopen Pluto with a persistent notice and a diagnostic log.
export const UPDATE_WORKER_SCRIPT = `#!/bin/bash
set -euo pipefail
exec >> "$PLUTO_UPDATE_LOG" 2>&1
finish() {
  status=$?
  if [[ $status != 0 ]]; then
    printf 'Update failed (exit %s). See the update log for details.\n' "$status" > "$PLUTO_UPDATE_RESULT"
    open "$PLUTO_UPDATE_APP" || true
  fi
  rm -rf "$PLUTO_UPDATE_SCRATCH"
}
trap finish EXIT
for ((attempt=0; attempt<60; attempt++)); do
  kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null; then
  echo 'Pluto did not finish shutting down. Nothing was installed.'
  exit 1
fi
/bin/bash "$PLUTO_UPDATE_INSTALLER" --directory "$PLUTO_UPDATE_DIRECTORY" --tag "$PLUTO_UPDATE_TAG"
`;

export class UpdateChecker {
  private currentStatus: UpdateInfo;
  private intervalTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private applying = false;
  private canUpdate: () => boolean;
  private getWindow: () => Electron.BrowserWindow | null;

  constructor(
    getWindow: () => Electron.BrowserWindow | null,
    canUpdate = () => true,
  ) {
    this.getWindow = getWindow;
    this.canUpdate = canUpdate;
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
        `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`,
        {
          headers: {
            'User-Agent': `Pluto-App/${currentVersion}`,
            Accept: 'application/vnd.github.v3+json',
          },
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const releases: unknown = await response.json();
      if (!Array.isArray(releases))
        throw new Error('Invalid GitHub releases response.');
      const data = newestInstallableRelease(releases);
      if (!data)
        throw new Error('No published Mac release with checksums was found.');

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

  public async applyUpdate(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    let scratch: string | undefined;
    let handedOff = false;
    try {
      if (!app.isPackaged)
        throw new Error('Updates are available in installed Pluto builds.');
      if (!this.canUpdate())
        throw new Error(
          'Stop your recording and wait for it to finish saving before updating.',
        );
      const tag = this.currentStatus.latestVersion;
      if (!this.currentStatus.hasUpdate || !tag)
        throw new Error('Check for a new release before updating.');
      parseVersion(tag);
      const appPath = dirname(dirname(dirname(app.getPath('exe'))));
      if (!appPath.endsWith('/Pluto.app'))
        throw new Error('Update the installed Pluto.app in Applications.');
      const response = await fetch(INSTALLER_URL, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`Installer download failed (${response.status}).`);
      const installer = await response.text();
      if (
        !installer.startsWith('#!/bin/bash') ||
        !installer.trimEnd().endsWith('main "$@"')
      ) {
        throw new Error(
          'Installer download is incomplete. Nothing was installed.',
        );
      }
      scratch = await mkdtemp(join(tmpdir(), 'pluto-update-'));
      const installerPath = join(scratch, 'install.sh');
      const workerPath = join(scratch, 'update.sh');
      const logPath = join(app.getPath('userData'), 'logs', 'update.log');
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(logPath, '', { flag: 'a', mode: 0o600 });
      await writeFile(installerPath, installer, { mode: 0o600 });
      await writeFile(workerPath, UPDATE_WORKER_SCRIPT, { mode: 0o600 });
      await rm(this.resultPath(), { force: true });
      // Recheck after downloading: a meeting could have started meanwhile.
      if (!this.canUpdate())
        throw new Error('Stop your recording before updating.');
      const child = spawn('/bin/bash', [workerPath], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PLUTO_UPDATE_LOG: logPath,
          PLUTO_UPDATE_RESULT: this.resultPath(),
          PLUTO_UPDATE_APP: appPath,
          PLUTO_UPDATE_DIRECTORY: dirname(appPath),
          PLUTO_UPDATE_INSTALLER: installerPath,
          PLUTO_UPDATE_SCRATCH: scratch,
          PLUTO_UPDATE_PARENT_PID: String(process.pid),
          PLUTO_UPDATE_TAG: tag,
        },
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      if (!this.canUpdate()) {
        child.kill();
        throw new Error('Stop your recording before updating.');
      }
      child.unref();
      scratch = undefined; // The detached helper owns cleanup from here.
      handedOff = true;
      app.quit();
    } catch (error) {
      log.warn('Update could not start', error);
      await dialog.showMessageBox({
        type: 'error',
        title: 'Pluto Update',
        message: 'Pluto could not start the update.',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['OK'],
      });
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
      if (!handedOff) this.applying = false;
    }
  }

  private resultPath(): string {
    return join(app.getPath('userData'), 'update-failure.txt');
  }

  public async showPreviousUpdateFailure(): Promise<void> {
    try {
      const failure = await readFile(this.resultPath(), 'utf8');
      await rm(this.resultPath(), { force: true });
      await dialog.showMessageBox({
        type: 'error',
        title: 'Pluto Update',
        message: 'Pluto could not finish the update.',
        detail: `${failure.trim()}\nYour meeting data and models were preserved.\nLog: ${join(app.getPath('userData'), 'logs', 'update.log')}`,
        buttons: ['OK'],
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        log.warn('Could not read update result', error);
    }
  }

  public start(): void {
    this.registerIpc();
    void this.showPreviousUpdateFailure();
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
    ipcMain.handle('PLUTO_UPDATER_APPLY_UPDATE', () => this.applyUpdate());
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
