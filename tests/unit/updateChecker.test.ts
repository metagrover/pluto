import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_WORKER_SCRIPT,
  UpdateChecker,
  compareVersions,
  newestInstallableRelease,
} from '../../electron/updateChecker';

const mocks = vi.hoisted(() => ({
  quit: vi.fn(),
  dialog: vi.fn(),
  spawn: vi.fn(),
  userData: '',
  packaged: true,
}));
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0-rc.8',
    get isPackaged() {
      return mocks.packaged;
    },
    getPath: (key: string) =>
      key === 'exe'
        ? '/Applications/Pluto.app/Contents/MacOS/Pluto'
        : mocks.userData,
    quit: mocks.quit,
  },
  dialog: { showMessageBox: mocks.dialog },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../electron/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: mocks.spawn,
}));

const release = (tag: string, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/metagrover/pluto/releases/tag/${tag}`,
  assets: [
    { name: 'SHA256SUMS.txt' },
    { name: `Pluto-Mac-${tag.slice(1).replace('.rc.', '-rc.')}-Installer.dmg` },
  ],
  ...extra,
});

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
});

it('orders RCs numerically, stable after RC, and supports old dot tags', () => {
  expect(compareVersions('v1.0.0-rc.10', '1.0.0-rc.9')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.0-rc.99')).toBe(1);
  expect(compareVersions('1.0.0-rc.8', '1.0.0')).toBe(-1);
  expect(compareVersions('v1.0.0.rc.8', '1.0.0-rc.8')).toBe(0);
  expect(() => compareVersions('not-a-version', '1.0.0')).toThrow();
});

it('selects the highest complete release, including RCs, without offering drafts or partial uploads', () => {
  expect(
    newestInstallableRelease([
      release('v1.0.0-rc.9'),
      release('v1.0.0-rc.10'),
      release('v1.0.0-rc.11', { assets: [] }),
      release('v2.0.0', { draft: true }),
      release('v3.0.0-beta.1'),
    ])?.tag_name,
  ).toBe('v1.0.0-rc.10');
  expect(
    newestInstallableRelease([release('v1.0.0'), release('v1.0.0-rc.99')])
      ?.tag_name,
  ).toBe('v1.0.0');
});

describe('UpdateChecker', () => {
  let root: string;
  let spawned: { args: string[]; env: NodeJS.ProcessEnv } | undefined;
  const validInstaller = '#!/bin/bash\nmain() { :; }\nmain "$@"\n';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pluto-updater-test-'));
    mocks.userData = root;
    mocks.packaged = true;
    vi.clearAllMocks();
    spawned = undefined;
    mocks.spawn.mockImplementation((_cmd, args, options) => {
      spawned = { args, env: options.env };
      const child = Object.assign(new EventEmitter(), {
        unref: vi.fn(),
        kill: vi.fn(),
      });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
  });
  afterEach(() => {
    if (spawned?.env.PLUTO_UPDATE_SCRATCH)
      rmSync(spawned.env.PLUTO_UPDATE_SCRATCH, {
        recursive: true,
        force: true,
      });
    rmSync(root, { recursive: true, force: true });
  });
  const check = async (checker: UpdateChecker) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [release('v1.0.0-rc.9')],
    });
    return checker.checkForUpdates();
  };
  it('checks the release list and reports an RC upgrade with notes', async () => {
    const checker = new UpdateChecker(() => null);
    expect(await check(checker)).toMatchObject({
      hasUpdate: true,
      latestVersion: 'v1.0.0-rc.9',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/releases?per_page=100'),
      expect.anything(),
    );
  });
  it('does not quit during recording or when installer download fails', async () => {
    const blocked = new UpdateChecker(
      () => null,
      () => false,
    );
    await check(blocked);
    await blocked.applyUpdate();
    expect(mocks.dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('Stop your recording'),
      }),
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
    const checker = new UpdateChecker(() => null);
    await check(checker);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await checker.applyUpdate();
    expect(mocks.dialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('404') }),
    );
    expect(mocks.quit).not.toHaveBeenCalled();
  });
  it('rejects a truncated installer and rechecks capture after downloading', async () => {
    let recording = false;
    const checker = new UpdateChecker(
      () => null,
      () => !recording,
    );
    await check(checker);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '#!/bin/bash\nmain() {',
    });
    await checker.applyUpdate();
    expect(mocks.spawn).not.toHaveBeenCalled();
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      recording = true;
      return { ok: true, text: async () => validInstaller };
    });
    await checker.applyUpdate();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
  });
  it('pins the shown release, keeps the installed directory and quits only after helper launch', async () => {
    const checker = new UpdateChecker(() => null);
    await check(checker);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => validInstaller });
    await checker.applyUpdate();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/master/scripts/install-macos.sh'),
      expect.anything(),
    );
    expect(spawned?.env).toMatchObject({
      PLUTO_UPDATE_TAG: 'v1.0.0-rc.9',
      PLUTO_UPDATE_DIRECTORY: '/Applications',
      PLUTO_UPDATE_PARENT_PID: String(process.pid),
    });
    expect(readFileSync(spawned!.args[0], 'utf8')).toBe(UPDATE_WORKER_SCRIPT);
    expect(mocks.quit).toHaveBeenCalledOnce();
    await checker.applyUpdate();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });
  it('keeps Pluto open if the update helper cannot spawn', async () => {
    const checker = new UpdateChecker(() => null);
    await check(checker);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => validInstaller });
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('spawn failed')));
      return child;
    });
    await checker.applyUpdate();
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.dialog).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'spawn failed' }),
    );
  });
  it('shows a persisted failure once after relaunch', async () => {
    writeFileSync(join(root, 'update-failure.txt'), 'Update failed (exit 42).');
    const checker = new UpdateChecker(() => null);
    await checker.showPreviousUpdateFailure();
    expect(mocks.dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pluto could not finish the update.',
        detail: expect.stringContaining('update.log'),
      }),
    );
    await checker.showPreviousUpdateFailure();
    expect(mocks.dialog).toHaveBeenCalledOnce();
  });
});

it.each([
  { mode: 'success', exit: 0 },
  { mode: 'failure', exit: 42 },
  { mode: 'shutdown timeout', exit: 1 },
])(
  'the detached shell handles $mode without replacing a running app',
  ({ mode, exit }) => {
    const root = mkdtempSync(join(tmpdir(), 'pluto-update-worker-'));
    try {
      const scratch = join(root, 'scratch');
      const bin = join(root, 'bin');
      mkdirSync(scratch);
      mkdirSync(bin);
      const installer = join(scratch, 'install.sh');
      const worker = join(scratch, 'worker.sh');
      const argsFile = join(root, 'args');
      const reopened = join(root, 'opened');
      const result = join(root, 'failure');
      writeFileSync(worker, UPDATE_WORKER_SCRIPT);
      writeFileSync(
        installer,
        `#!/bin/bash\nprintf '%s\\n' "$@" > "$TEST_ARGS"\necho 'fixture installer result'\nexit ${mode === 'failure' ? 42 : 0}\n`,
      );
      writeFileSync(
        join(bin, 'open'),
        '#!/bin/bash\nprintf "%s" "$1" > "$TEST_OPENED"\n',
        { mode: 0o755 },
      );
      writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', {
        mode: 0o755,
      });
      const run = spawnSync('/bin/bash', [worker], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_ARGS: argsFile,
          TEST_OPENED: reopened,
          PLUTO_UPDATE_LOG: join(root, 'update.log'),
          PLUTO_UPDATE_RESULT: result,
          PLUTO_UPDATE_APP: '/fixture Applications/Pluto.app',
          PLUTO_UPDATE_DIRECTORY: '/fixture Applications',
          PLUTO_UPDATE_INSTALLER: installer,
          PLUTO_UPDATE_SCRATCH: scratch,
          PLUTO_UPDATE_PARENT_PID:
            mode === 'shutdown timeout' ? String(process.pid) : '99999999',
          PLUTO_UPDATE_TAG: 'v1.0.0-rc.9',
        },
      });
      expect(run.status).toBe(exit);
      if (mode === 'shutdown timeout') {
        expect(existsSync(argsFile)).toBe(false);
        expect(readFileSync(join(root, 'update.log'), 'utf8')).toContain(
          'Nothing was installed',
        );
      } else {
        expect(readFileSync(argsFile, 'utf8').trim().split('\n')).toEqual([
          '--directory',
          '/fixture Applications',
          '--tag',
          'v1.0.0-rc.9',
        ]);
      }
      if (exit !== 0) {
        expect(readFileSync(result, 'utf8')).toContain(`exit ${exit}`);
        expect(readFileSync(reopened, 'utf8')).toBe(
          '/fixture Applications/Pluto.app',
        );
      } else {
        expect(existsSync(result)).toBe(false);
        expect(existsSync(reopened)).toBe(false);
      }
      expect(existsSync(scratch)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
