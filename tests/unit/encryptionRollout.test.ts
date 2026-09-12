import { describe, expect, it } from 'vitest';
import { resolveEncryptionRolloutPolicy } from '../../electron/encryptionRollout';

describe('encryption rollout policy', () => {
  it('keeps every write and cleanup gate dark by default', () => {
    expect(
      resolveEncryptionRolloutPolicy({
        isPackaged: true,
        signedBuild: { valid: true, reason: 'signed_distribution_build' },
      }),
    ).toEqual({
      mode: 'off',
      encryptedCaptureWrites: false,
      encryptedNativeReads: true,
      historicalAudioMigration: false,
      retentionEnforcement: false,
      reason: 'rollout_not_requested',
    });
  });

  it('rejects unsigned and development canaries without partial enablement', () => {
    expect(
      resolveEncryptionRolloutPolicy({
        isPackaged: false,
        requestedMode: 'signed_canary',
        historicalMigrationRequested: '1',
        retentionEnforcementRequested: '1',
        signedBuild: { valid: true, reason: 'signed_distribution_build' },
      }).reason,
    ).toBe('packaged_build_required');
    expect(
      resolveEncryptionRolloutPolicy({
        isPackaged: true,
        requestedMode: 'signed_canary',
        historicalMigrationRequested: '1',
        retentionEnforcementRequested: '1',
        signedBuild: {
          valid: false,
          reason: 'signature_not_distribution_bound',
        },
      }),
    ).toMatchObject({
      mode: 'off',
      encryptedCaptureWrites: false,
      historicalAudioMigration: false,
      retentionEnforcement: false,
    });
  });

  it('keeps migration and retention as separate explicit canary gates', () => {
    const captureOnly = resolveEncryptionRolloutPolicy({
      isPackaged: true,
      requestedMode: 'signed_canary',
      signedBuild: { valid: true, reason: 'signed_distribution_build' },
    });
    expect(captureOnly).toMatchObject({
      mode: 'signed_canary',
      encryptedCaptureWrites: true,
      historicalAudioMigration: false,
      retentionEnforcement: false,
    });

    expect(
      resolveEncryptionRolloutPolicy({
        isPackaged: true,
        requestedMode: 'signed_canary',
        historicalMigrationRequested: '1',
        retentionEnforcementRequested: '1',
        signedBuild: { valid: true, reason: 'signed_distribution_build' },
      }),
    ).toMatchObject({
      encryptedCaptureWrites: true,
      historicalAudioMigration: true,
      retentionEnforcement: true,
    });
  });
});
