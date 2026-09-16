import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canOpenProductionDatabase,
  resolveDevelopmentUserDataDir,
  resolveProductionUserDataDir,
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from '../../electron/appRuntimePolicy';

describe('Pluto application runtime policy', () => {
  it('acquires the shared-profile lock only for packaged production', () => {
    expect(shouldAcquireProductionInstanceLock(true)).toBe(true);
    expect(shouldAcquireProductionInstanceLock(false)).toBe(false);
  });

  it('honors an explicit development profile directory', () => {
    expect(
      resolveDevelopmentUserDataDir({
        explicit: '/tmp/pluto-test-profile',
        tempDir: '/tmp',
      }),
    ).toBe('/tmp/pluto-test-profile');
  });

  it('uses a stable non-production development profile by default', () => {
    expect(resolveDevelopmentUserDataDir({ tempDir: '/private/tmp' })).toBe(
      path.join('/private/tmp', 'pluto-development-profile'),
    );
  });

  it('rejects the production profile as a development override', () => {
    expect(() =>
      resolveDevelopmentUserDataDir({
        explicit: '/Users/pluto/Library/Application Support/pluto',
        tempDir: '/private/tmp',
        productionDir: '/Users/pluto/Library/Application Support/pluto',
      }),
    ).toThrow('Development Electron cannot open the Pluto production profile');
  });

  it('allows the production profile only for explicit recovery startup', () => {
    expect(
      resolveDevelopmentUserDataDir({
        explicit: '/Users/pluto/Library/Application Support/pluto',
        tempDir: '/private/tmp',
        productionDir: '/Users/pluto/Library/Application Support/pluto',
        allowProductionRecovery: true,
      }),
    ).toBe('/Users/pluto/Library/Application Support/pluto');
  });

  it('resolves the production profile only on macOS', () => {
    expect(
      resolveProductionUserDataDir({
        platform: 'darwin',
        homeDir: '/Users/pluto',
      }),
    ).toBe('/Users/pluto/Library/Application Support/pluto');
    expect(
      resolveProductionUserDataDir({
        platform: 'linux',
        homeDir: '/home/pluto',
      }),
    ).toBeNull();
  });

  it('permits production access only to a verified packaged build', () => {
    expect(
      canOpenProductionDatabase({
        isPackaged: true,
        signedBuildValid: false,
      }),
    ).toBe(false);
    expect(
      canOpenProductionDatabase({
        isPackaged: false,
        signedBuildValid: false,
        targetsProductionProfile: true,
        recoveryKeyAvailable: true,
      }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({
        isPackaged: true,
        signedBuildValid: true,
      }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({
        isPackaged: false,
        signedBuildValid: false,
        targetsProductionProfile: false,
      }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({
        isPackaged: true,
        signedBuildValid: false,
        allowUnsignedPackaged: true,
      }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({
        isPackaged: false,
        signedBuildValid: false,
        targetsProductionProfile: true,
      }),
    ).toBe(false);
  });

  it('reads the exact development profile passed to Electron', () => {
    expect(
      resolveUserDataArgument([
        '/Applications/Electron',
        '.',
        '--user-data-dir=/tmp/pluto-development-profile',
      ]),
    ).toBe('/tmp/pluto-development-profile');
    expect(resolveUserDataArgument(['/Applications/Electron'])).toBeNull();
  });
});
