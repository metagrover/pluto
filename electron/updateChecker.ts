import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  update?: { phase: UpdatePhase; message: string };
}

export type UpdatePhase =
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'quitting'
  | 'installing'
  | 'restarting'
  | 'failed'
  | 'complete';
const UPDATE_MESSAGES: Record<UpdatePhase, string> = {
  preparing: 'Preparing update…',
  downloading: 'Downloading update… You can keep Pluto open.',
  verifying: 'Verifying update…',
  ready: 'Update verified. Preparing to restart…',
  quitting:
    'Closing Pluto to install the update. It will reopen automatically.',
  installing: 'Installing update…',
  restarting: 'Reopening Pluto…',
  failed: 'Update failed. Retry when you are ready.',
  complete: 'Pluto is up to date.',
};

export type UpdateApplyResult =
  | { started: true }
  | { started: false; error: string };

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
    phase=$(cat "$PLUTO_UPDATE_PROGRESS" 2>/dev/null || echo preparing)
    detail=$(cat "$PLUTO_UPDATE_ERROR" 2>/dev/null || echo 'See the update log for details.')
    printf 'Update failed during %s (exit %s). %s\\n' "$phase" "$status" "$detail" > "$PLUTO_UPDATE_RESULT"
    if [[ -e "$PLUTO_UPDATE_COMMIT" ]] && ! kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null; then
      open -na "$PLUTO_UPDATE_APP" --args "--user-data-dir=$PLUTO_UPDATE_USER_DATA" || true
    fi
  fi
  rm -rf "$PLUTO_UPDATE_SCRATCH"
}
trap finish EXIT
/bin/bash "$PLUTO_UPDATE_INSTALLER" --directory "$PLUTO_UPDATE_DIRECTORY" --tag "$PLUTO_UPDATE_TAG" --user-data-dir "$PLUTO_UPDATE_USER_DATA"
`;

export class UpdateChecker {
  private currentStatus: UpdateInfo;
  private intervalTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private applying = false;
  private attempt = 0;
  private applyPromise: Promise<UpdateApplyResult> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  public get isApplying(): boolean {
    return this.applying;
  }

  private progress(phase: UpdatePhase, message = UPDATE_MESSAGES[phase]) {
    if (
      this.currentStatus.update?.phase === phase &&
      this.currentStatus.update.message === message
    )
      return;
    this.currentStatus = { ...this.currentStatus, update: { phase, message } };
    this.broadcastStatus();
  }
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
    if (this.applying) return this.currentStatus;
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
      if (this.applying) return this.currentStatus;
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
        update:
          hasUpdate && this.currentStatus.update?.phase === 'complete'
            ? undefined
            : this.currentStatus.update,
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
      if (this.applying) return this.currentStatus;
      const message = err instanceof Error ? err.message : String(err);
      log.warn('GitHub release check failed', {
        error: message,
      });
      this.currentStatus = {
        ...this.currentStatus,
        currentVersion,
        checkedAt: Date.now(),
        error: message,
      };
      this.broadcastStatus();
      return this.currentStatus;
    }
  }

  public applyUpdate(): Promise<UpdateApplyResult> {
    if (this.applyPromise) return this.applyPromise;
    if (this.applying) return Promise.resolve({ started: true });
    this.applying = true;
    this.progress('preparing');
    const pending = this.startUpdate(++this.attempt);
    this.applyPromise = pending;
    void pending.finally(() => {
      if (this.applyPromise === pending) this.applyPromise = null;
    });
    return pending;
  }

  private async startUpdate(attempt: number): Promise<UpdateApplyResult> {
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
      // Ship the verified installer with Pluto so a separate source-code download
      // cannot prevent an otherwise available release from starting.
      let installer: string;
      try {
        installer = await readFile(
          join(dirname(app.getAppPath()), 'installer', 'install-macos.sh'),
          'utf8',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            'The update installer is missing from this Pluto build. Reinstall Pluto to update.',
          );
        }
        throw error;
      }
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
      await rm(join(app.getPath('userData'), 'update-target.txt'), {
        force: true,
      });
      const progressPath = join(scratch, 'progress');
      const commitPath = join(scratch, 'commit');
      const cancelPath = join(scratch, 'cancel');
      // Recheck after downloading: a meeting could have started meanwhile.
      if (!this.canUpdate())
        throw new Error('Stop your recording before updating.');
      const child = spawn('/bin/bash', [workerPath], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PLUTO_UPDATE_PROGRESS: progressPath,
          PLUTO_UPDATE_COMMIT: commitPath,
          PLUTO_UPDATE_CANCEL: cancelPath,
          PLUTO_UPDATE_ERROR: join(scratch, 'error'),
          PLUTO_UPDATE_TARGET: join(
            app.getPath('userData'),
            'update-target.txt',
          ),
          PLUTO_UPDATE_LOG: logPath,
          PLUTO_UPDATE_RESULT: this.resultPath(),
          PLUTO_UPDATE_APP: appPath,
          PLUTO_UPDATE_DIRECTORY: dirname(appPath),
          PLUTO_UPDATE_USER_DATA: app.getPath('userData'),
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
        await writeFile(cancelPath, 'cancel');
      }
      let finished = false;
      let quitRequested = false;
      let polling = false;
      const poll = async () => {
        if (polling || !this.applying) return;
        polling = true;
        try {
          const phase = (
            await readFile(progressPath, 'utf8')
          ).trim() as UpdatePhase;
          if (finished || !(phase in UPDATE_MESSAGES)) return;
          if (phase === 'ready' && !quitRequested) {
            quitRequested = true;
            if (!this.canUpdate()) {
              await writeFile(cancelPath, 'cancel');
              return;
            }
            await writeFile(commitPath, 'install', { mode: 0o600 });
            this.progress('quitting');
            app.quit();
          } else if (!quitRequested) this.progress(phase);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            log.warn('Could not read update progress', error);
        } finally {
          polling = false;
        }
      };
      this.progressTimer = setInterval(() => {
        void poll();
      }, 250);
      this.progressTimer.unref?.();
      const exited = () => {
        if (finished) return;
        finished = true;
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = null;
        void this.showPreviousUpdateFailure().then((reported) => {
          if (!reported && this.attempt === attempt) {
            this.applying = false;
            this.progress(
              'failed',
              'The update installer stopped before completion. Retry the update.',
            );
          }
        });
      };
      child.once('exit', exited);
      if (child.exitCode != null || child.signalCode != null) exited();
      child.unref();
      scratch = undefined; // The detached helper owns cleanup from here.
      handedOff = true;
      return { started: true };
    } catch (error) {
      log.warn('Update could not start', error);
      this.progress(
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      return {
        started: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (!handedOff) this.applying = false;
      if (scratch)
        await rm(scratch, { recursive: true, force: true }).catch((error) =>
          log.warn('Could not remove update scratch directory', error),
        );
    }
  }

  private resultPath(): string {
    return join(app.getPath('userData'), 'update-failure.txt');
  }

  public async showPreviousUpdateFailure(): Promise<boolean> {
    try {
      const failure = await readFile(this.resultPath(), 'utf8');
      await rm(this.resultPath(), { force: true });
      this.applying = false;
      this.progress('failed', failure.trim());
      await dialog.showMessageBox({
        type: 'error',
        title: 'Pluto Update',
        message: 'Pluto could not finish the update.',
        detail: `${failure.trim()}\nYour meeting data and models were preserved.\nLog: ${join(app.getPath('userData'), 'logs', 'update.log')}`,
        buttons: ['OK'],
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Could not read update result', error);
        return false;
      }
      try {
        const targetPath = join(app.getPath('userData'), 'update-target.txt');
        const target = (await readFile(targetPath, 'utf8')).trim();
        this.applying = false;
        if (compareVersions(app.getVersion(), target) >= 0) {
          this.progress('complete', `Updated to Pluto ${app.getVersion()}.`);
          await rm(targetPath, { force: true });
        } else
          this.progress(
            'failed',
            `Update did not finish: Pluto ${app.getVersion()} is still running. Retry the update.`,
          );
        return true;
      } catch {
        return false;
      }
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
    if (this.progressTimer) clearInterval(this.progressTimer);
  }

  private broadcastStatus(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(
          'pluto-updater:status-changed',
          this.currentStatus,
        );
      } catch {
        /* Renderer shutdown cannot interrupt updater ownership. */
      }
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
