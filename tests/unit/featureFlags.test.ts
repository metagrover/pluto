import { describe, expect, it } from 'vitest';

import { listLocalArtifacts } from '../../src/api/localArtifacts';
import {
  FEATURE_FLAGS,
  assertFeatureEnabled,
  isFeatureEnabled,
} from '../../src/config/featureFlags';

describe('feature flags', () => {
  it('keeps Sources disabled by default', () => {
    expect(FEATURE_FLAGS.sources).toBe(false);
    expect(isFeatureEnabled('sources')).toBe(false);
    expect(() => assertFeatureEnabled('sources')).toThrow(
      'feature_disabled:sources',
    );
  });

  it('blocks the renderer API before invoking IPC', () => {
    expect(() => listLocalArtifacts()).toThrow('feature_disabled:sources');
  });
});
