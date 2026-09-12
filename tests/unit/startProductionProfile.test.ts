import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  launchSignedPlutoApp,
  resolveInstalledPlutoApp,
  verifySignedPlutoApp,
} from '../../scripts/start_production_profile.mjs';

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
});
