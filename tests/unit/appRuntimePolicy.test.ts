import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canOpenProductionDatabase,
  resolveDevelopmentUserDataDir,
  resolveProductionUserDataDir,
  resolveUserDataArgument,
} from '../../electron/appRuntimePolicy';

describe('Pluto application runtime policy', () => {
  it('uses the persistent application profile for both source commands', () => {
    const productionDir = resolveProductionUserDataDir({
      platform: 'darwin',
      homeDir: '/Users/pluto',
    });
    expect(productionDir).toBe(
      '/Users/pluto/Library/Application Support/pluto',
    );
    expect(
      resolveDevelopmentUserDataDir({
        tempDir: '/tmp',
        productionDir: productionDir!,
      }),
    ).toBe(productionDir);
  });
  it('honors explicit profiles including existing isolated development meetings', () => {
    const productionDir = '/Users/pluto/Library/Application Support/pluto';
    for (const explicit of [
      productionDir,
      '/tmp/pluto-development-profile',
      '/tmp/pluto-test-profile',
    ]) {
      expect(
        resolveDevelopmentUserDataDir({
          explicit,
          tempDir: '/private/tmp',
          productionDir,
        }),
      ).toBe(explicit);
    }
    expect(
      resolveDevelopmentUserDataDir({
        explicit: '  ',
        tempDir: '/tmp',
        productionDir,
      }),
    ).toBe(productionDir);
  });
  it('keeps the fallback path for unsupported platforms', () => {
    expect(
      resolveProductionUserDataDir({
        platform: 'linux',
        homeDir: '/home/pluto',
      }),
    ).toBeNull();
    expect(resolveDevelopmentUserDataDir({ tempDir: '/private/tmp' })).toBe(
      path.join('/private/tmp', 'pluto-development-profile'),
    );
  });
  it('allows normal source startup without a signed app and preserves packaged enforcement', () => {
    expect(
      canOpenProductionDatabase({ isPackaged: false, signedBuildValid: false }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({ isPackaged: true, signedBuildValid: false }),
    ).toBe(false);
    expect(
      canOpenProductionDatabase({ isPackaged: true, signedBuildValid: true }),
    ).toBe(true);
    expect(
      canOpenProductionDatabase({
        isPackaged: true,
        signedBuildValid: false,
        allowUnsignedPackaged: true,
      }),
    ).toBe(true);
  });
  it('reads the exact selected profile passed to Electron', () => {
    expect(
      resolveUserDataArgument([
        '/Applications/Electron',
        '.',
        '--user-data-dir=/tmp/pluto-test-profile',
      ]),
    ).toBe('/tmp/pluto-test-profile');
    expect(resolveUserDataArgument(['/Applications/Electron'])).toBeNull();
  });
});
