import { app, ipcMain, shell } from 'electron';
import { createLogger } from './logger';

const log = createLogger('UpdateChecker');

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt: number;
  error?: string;
}

const GITHUB_REPO = 'metagrover/pluto';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_CHECK_DELAY_MS = 10 * 1000; // 10 seconds
const REQUEST_TIMEOUT_MS = 15_000;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

type GithubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

export type ParsedGithubRelease = Pick<
  UpdateInfo,
  'hasUpdate' | 'latestVersion' | 'releaseUrl' | 'downloadUrl' | 'releaseNotes'
>;

const parseVersion = (value: string): [number, number, number] | null => {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

export const isAllowedGithubReleaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${GITHUB_REPO}/releases/`)
    );
  } catch {
    return false;
  }
};

/**
 * Compare semver strings (e.g. "0.2.0" vs "0.1.0").
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = parseVersion(v1);
  const parts2 = parseVersion(v2);
  if (!parts1 || !parts2) throw new Error('invalid_release_version');
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

export const parseGithubRelease = (
  data: GithubRelease,
  currentVersion: string,
): ParsedGithubRelease => {
  if (data.draft === true || data.prerelease === true) {
    throw new Error('GitHub returned a non-stable release');
  }
  if (typeof data.tag_name !== 'string' || !parseVersion(data.tag_name)) {
    throw new Error('GitHub returned an invalid release tag');
  }
  const latestTag = data.tag_name;
  const latestVersion = latestTag.replace(/^v/, '');
  const expectedAssetName = `Pluto-Mac-${latestVersion}-Installer.dmg`;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const asset = assets.find((candidate): candidate is Record<string, unknown> =>
    Boolean(
      candidate &&
        typeof candidate === 'object' &&
        (candidate as Record<string, unknown>).name === expectedAssetName,
    ),
  );
  const downloadUrl =
    asset && typeof asset.browser_download_url === 'string'
      ? asset.browser_download_url
      : undefined;
  if (downloadUrl && !isAllowedGithubReleaseUrl(downloadUrl)) {
    throw new Error('GitHub returned an unsafe download URL');
  }
  const releaseUrl =
    typeof data.html_url === 'string' &&
    isAllowedGithubReleaseUrl(data.html_url)
      ? data.html_url
      : `${RELEASES_URL}/tag/${latestTag}`;
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  if (hasUpdate && !downloadUrl) {
    throw new Error(`Release is missing ${expectedAssetName}`);
  }
  return {
    hasUpdate,
    latestVersion: latestTag,
    releaseUrl,
    downloadUrl,
    releaseNotes: typeof data.body === 'string' ? data.body : undefined,
  };
};

export const selectLatestGithubAppRelease = (
  releases: GithubRelease[],
  currentVersion: string,
): ParsedGithubRelease => {
  const candidates = releases
    .filter(
      (release) =>
        release.draft !== true &&
        release.prerelease !== true &&
        typeof release.tag_name === 'string' &&
        parseVersion(release.tag_name) !== null,
    )
    .sort((left, right) =>
      compareVersions(String(right.tag_name), String(left.tag_name)),
    );
  const latest = candidates[0];
  if (!latest) throw new Error('No stable Pluto app release is available');
  return parseGithubRelease(latest, currentVersion);
};

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
        `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`,
        {
          headers: {
            'User-Agent': `Pluto-App/${currentVersion}`,
            Accept: 'application/vnd.github.v3+json',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (response.status === 404) {
        this.currentStatus = {
          hasUpdate: false,
          currentVersion,
          checkedAt: Date.now(),
          error: 'No public Pluto app release is available yet.',
        };
        log.info('Public GitHub release feed is not available yet');
        this.broadcastStatus();
        return this.currentStatus;
      }

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('GitHub returned an invalid release feed');
      }
      const release = selectLatestGithubAppRelease(data, currentVersion);

      this.currentStatus = {
        ...release,
        currentVersion,
        checkedAt: Date.now(),
      };

      if (release.hasUpdate) {
        log.info('New update available', {
          current: currentVersion,
          latest: release.latestVersion,
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

  public async downloadUpdate(): Promise<void> {
    const targetUrl = this.currentStatus.downloadUrl;
    if (!targetUrl || !isAllowedGithubReleaseUrl(targetUrl)) {
      throw new Error('No verified Pluto DMG is available');
    }
    await shell.openExternal(targetUrl);
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
    ipcMain.handle('PLUTO_UPDATER_DOWNLOAD_UPDATE', () =>
      this.downloadUpdate(),
    );
    ipcMain.handle(
      'PLUTO_UPDATER_OPEN_RELEASE_URL',
      async (_event, url?: string) => {
        const targetUrl = url || this.currentStatus.releaseUrl;
        if (!targetUrl || !isAllowedGithubReleaseUrl(targetUrl)) {
          throw new Error('Refusing to open an untrusted release URL');
        }
        await shell.openExternal(targetUrl);
      },
    );
  }
}
