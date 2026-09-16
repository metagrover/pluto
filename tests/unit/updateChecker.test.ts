import { describe, expect, it, vi } from 'vitest';

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0' },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal },
}));

import {
  UpdateChecker,
  compareVersions,
  isAllowedGithubReleaseUrl,
  parseGithubRelease,
  selectLatestGithubAppRelease,
} from '../../electron/updateChecker';

describe('compareVersions', () => {
  it('identifies newer versions correctly', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1);
    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('v1.0.0', 'v0.9.5')).toBe(1);
  });

  it('identifies older versions correctly', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
  });

  it('identifies equal versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v1.2.3', 'v1.2.3')).toBe(0);
  });

  it('rejects malformed or extended versions', () => {
    for (const version of ['1.2', '1.2.3-beta.1', '01.2.3', '1.2.3.4']) {
      expect(() => compareVersions(version, '1.0.0')).toThrow(
        'invalid_release_version',
      );
    }
  });
});

describe('GitHub release validation', () => {
  const validRelease = {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/metagrover/pluto/releases/tag/v0.2.0',
    body: 'Release notes',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Pluto-Mac-0.2.0-Installer.dmg',
        browser_download_url:
          'https://github.com/metagrover/pluto/releases/download/v0.2.0/Pluto-Mac-0.2.0-Installer.dmg',
      },
    ],
  };

  it('selects only the deterministic arm64 DMG asset', () => {
    expect(parseGithubRelease(validRelease, '0.1.0')).toMatchObject({
      hasUpdate: true,
      latestVersion: 'v0.2.0',
      downloadUrl:
        'https://github.com/metagrover/pluto/releases/download/v0.2.0/Pluto-Mac-0.2.0-Installer.dmg',
    });
    expect(() =>
      parseGithubRelease(
        {
          ...validRelease,
          assets: [{ name: 'Pluto-Mac-0.2.0-x64.dmg' }],
        },
        '0.1.0',
      ),
    ).toThrow('Release is missing');
  });

  it('selects the newest app release and ignores unrelated stable releases', () => {
    expect(
      selectLatestGithubAppRelease(
        [
          {
            tag_name: 'speaker-models-sherpa-onnx-1.13.4-pluto.1',
            draft: false,
            prerelease: false,
          },
          validRelease,
          {
            ...validRelease,
            tag_name: 'v0.1.5',
            html_url: 'https://github.com/metagrover/pluto/releases/tag/v0.1.5',
            assets: [
              {
                name: 'Pluto-Mac-0.1.5-Installer.dmg',
                browser_download_url:
                  'https://github.com/metagrover/pluto/releases/download/v0.1.5/Pluto-Mac-0.1.5-Installer.dmg',
              },
            ],
          },
        ],
        '0.1.0',
      ),
    ).toMatchObject({ latestVersion: 'v0.2.0', hasUpdate: true });
  });

  it('rejects prereleases, malformed tags, and non-GitHub URLs', () => {
    expect(() =>
      parseGithubRelease({ ...validRelease, prerelease: true }, '0.1.0'),
    ).toThrow('non-stable');
    expect(() =>
      parseGithubRelease({ ...validRelease, tag_name: 'v0.2.0-rc.1' }, '0.1.0'),
    ).toThrow('invalid release tag');
    expect(() =>
      parseGithubRelease(
        {
          ...validRelease,
          assets: [
            {
              name: 'Pluto-Mac-0.2.0-Installer.dmg',
              browser_download_url: 'https://example.com/Pluto.dmg',
            },
          ],
        },
        '0.1.0',
      ),
    ).toThrow('unsafe download URL');
    expect(
      isAllowedGithubReleaseUrl(
        'http://github.com/metagrover/pluto/releases/tag/v1.0.0',
      ),
    ).toBe(false);
    expect(
      isAllowedGithubReleaseUrl(
        'https://github.com/other/pluto/releases/tag/v1.0.0',
      ),
    ).toBe(false);
  });

  it('opens only the already-validated DMG URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([validRelease]))),
    );
    const checker = new UpdateChecker(() => null);
    await checker.checkForUpdates();
    await checker.downloadUpdate();
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringMatching(/Pluto-Mac-0\.2\.0-Installer\.dmg$/),
    );
  });

  it('treats an unavailable public release feed as a quiet no-update state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const checker = new UpdateChecker(() => null);

    await expect(checker.checkForUpdates()).resolves.toMatchObject({
      hasUpdate: false,
      currentVersion: '0.1.0',
      error: 'No public Pluto app release is available yet.',
    });
  });
});
