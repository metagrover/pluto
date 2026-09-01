import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveDevelopmentUserDataDir,
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
