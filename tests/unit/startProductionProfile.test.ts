import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasValidRecoveryKeyFile,
  launchRecoveryDevelopmentApp,
  launchSignedPlutoApp,
  resolveInstalledPlutoApp,
  verifySignedPlutoApp,
} from '../../scripts/start_production_profile.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('production Pluto launcher', () => {
  it('resolves the installed macOS app without touching its data profile', () => {
    expect(
      resolveInstalledPlutoApp({
        platform: 'darwin',
        applicationsDir: '/Applications',
      }),
    ).toBe(path.join('/Applications', 'Pluto.app'));
    expect(
      resolveInstalledPlutoApp({
        platform: 'darwin',
        override: '/tmp/Signed Pluto.app',
      }),
    ).toBe('/tmp/Signed Pluto.app');
  });

  it('requires the Pluto bundle identifier and a distribution signing team', () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr:
          'Identifier=com.pluto.app\nAuthority=Developer ID Application: Pluto\nTeamIdentifier=PLUTOTEAM1\n',
      });

    expect(
      verifySignedPlutoApp({
        appPath: '/Applications/Pluto.app',
        exists: () => true,
        spawn,
      }),
    ).toEqual({
      identifier: 'com.pluto.app',
      teamIdentifier: 'PLUTOTEAM1',
    });
  });

  it.each([
    'Signature=adhoc\nIdentifier=com.pluto.app\nTeamIdentifier=not set\n',
    'Identifier=com.someone.else\nAuthority=Developer ID Application: Other\nTeamIdentifier=OTHERTEAM1\n',
  ])('rejects an unsafe app identity before launch', (details) => {
    expect(() =>
      verifySignedPlutoApp({
        appPath: '/Applications/Pluto.app',
        exists: () => true,
        spawn: vi
          .fn()
          .mockReturnValueOnce({ status: 0 })
          .mockReturnValueOnce({ status: 0, stdout: '', stderr: details }),
      }),
    ).toThrow('Refusing to open production data');
  });

  it('launches the verified app through Launch Services', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    launchSignedPlutoApp({
      appPath: '/Applications/Pluto.app',
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['/Applications/Pluto.app'],
      { stdio: 'inherit' },
    );
  });

  it('validates and launches the explicit owner-only recovery profile', () => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-start-recovery-'),
    );
    roots.push(userDataDir);
    const recoveryPath = path.join(userDataDir, 'app-recovery-key.json');
    fs.writeFileSync(
      recoveryPath,
      JSON.stringify({
        version: 1,
        purpose: 'pluto-database-recovery',
        keyId: '123e4567-e89b-42d3-a456-426614174000',
        key: Buffer.alloc(32, 0x41).toString('base64'),
        salt: Buffer.alloc(32, 0x42).toString('base64'),
      }),
      { mode: 0o600 },
    );
    fs.chmodSync(recoveryPath, 0o600);
    expect(hasValidRecoveryKeyFile({ userDataDir })).toBe(true);

    const spawn = vi.fn(() => ({ status: 0 }));
    launchRecoveryDevelopmentApp({
      userDataDir,
      environment: { PATH: '/bin' },
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith('pnpm', ['exec', 'vite'], {
      env: {
        PATH: '/bin',
        PLUTO_ALLOW_RECOVERY_PROFILE: '1',
        PLUTO_USER_DATA_DIR: userDataDir,
      },
      stdio: 'inherit',
    });
  });
});
