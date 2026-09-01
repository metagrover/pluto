import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createProductionBackup,
  launchDevelopmentApp,
  resolveProductionProfile,
} from '../../scripts/start_production_profile.mjs';

describe('production-profile development launcher', () => {
  it('resolves Pluto production data on macOS', () => {
    expect(
      resolveProductionProfile({
        platform: 'darwin',
        homeDir: '/Users/pluto',
      }),
    ).toBe(
      path.join('/Users/pluto', 'Library', 'Application Support', 'pluto'),
    );
  });

  it('creates one recovery snapshot without overwriting it', () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: 'ok\n' });
    const rename = vi.fn();
    const exists = vi.fn((candidate: string) => candidate.endsWith('pluto.db'));

    expect(
      createProductionBackup({
        userDataDir: '/profile',
        exists,
        spawn,
        rename,
        processId: 42,
      }),
    ).toBe('created');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[0]).toBe('sqlite3');
    expect(spawn.mock.calls[0]?.[1]?.[0]).toBe('/profile/pluto.db');
    expect(spawn.mock.calls[0]?.[1]?.[1]).toContain(
      '/profile/pluto.db.before-pnpm-start.backup.in-progress-42',
    );
    expect(rename).toHaveBeenCalledWith(
      '/profile/pluto.db.before-pnpm-start.backup.in-progress-42',
      '/profile/pluto.db.before-pnpm-start.backup',
    );

    spawn.mockReturnValueOnce({ status: 0, stdout: 'ok\n' });
    expect(
      createProductionBackup({
        userDataDir: '/profile',
        exists: () => true,
        spawn,
        rename,
      }),
    ).toBe('existing');
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(rename).toHaveBeenCalledOnce();
  });

  it('fails closed when an existing recovery snapshot is corrupt', () => {
    expect(() =>
      createProductionBackup({
        userDataDir: '/profile',
        exists: () => true,
        spawn: () => ({
          status: 0,
          stdout: 'database disk image is malformed',
        }),
      }),
    ).toThrow('Production-profile recovery snapshot failed integrity check');
  });

  it('starts Vite with only the explicit production profile override', () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    launchDevelopmentApp({
      userDataDir: '/profile',
      environment: { PATH: '/bin' },
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith('pnpm', ['exec', 'vite'], {
      env: { PATH: '/bin', PLUTO_USER_DATA_DIR: '/profile' },
      stdio: 'inherit',
    });
  });
});
