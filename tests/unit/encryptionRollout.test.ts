import { describe, expect, it, vi } from 'vitest';
import {
  probeSignedMacBuild,
  resolveEncryptionRolloutPolicy,
} from '../../electron/encryptionRollout';

describe('encryption rollout policy', () => {
  it('enables audio budget cleanup without enabling encrypted capture by default', () => {
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
      retentionEnforcement: true,
      reason: 'rollout_not_requested',
    });
  });

  it('rejects unsigned and development encrypted capture while allowing cleanup', () => {
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
      retentionEnforcement: true,
    });
  });

  it('keeps historical migration opt-in while cleanup stays enabled', () => {
    const captureOnly = resolveEncryptionRolloutPolicy({
      isPackaged: true,
      requestedMode: 'signed_canary',
      signedBuild: { valid: true, reason: 'signed_distribution_build' },
    });
    expect(captureOnly).toMatchObject({
      mode: 'signed_canary',
      encryptedCaptureWrites: true,
      historicalAudioMigration: false,
      retentionEnforcement: true,
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

  it('supports disabling cleanup independently in every rollout mode', () => {
    for (const isPackaged of [false, true]) {
      for (const requestedMode of [undefined, 'signed_canary']) {
        expect(
          resolveEncryptionRolloutPolicy({
            isPackaged,
            requestedMode,
            retentionEnforcementRequested: '0',
            signedBuild: { valid: true, reason: 'signed_distribution_build' },
          }).retentionEnforcement,
        ).toBe(false);
      }
    }
  });
});

describe.runIf(process.platform === 'darwin')(
  'signed Pluto identity probe',
  () => {
    it('returns the verified identifier and signing team', () => {
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
        probeSignedMacBuild('/Applications/Pluto.app/Contents/MacOS/Pluto', {
          expectedIdentifier: 'com.pluto.app',
          spawn: spawn as never,
        }),
      ).toEqual({
        valid: true,
        reason: 'signed_distribution_build',
        identifier: 'com.pluto.app',
        teamIdentifier: 'PLUTOTEAM1',
      });
    });

    it('rejects a differently identified signed app', () => {
      const spawn = vi
        .fn()
        .mockReturnValueOnce({ status: 0 })
        .mockReturnValueOnce({
          status: 0,
          stdout: '',
          stderr:
            'Identifier=com.other.app\nAuthority=Developer ID Application: Other\nTeamIdentifier=OTHERTEAM1\n',
        });
      expect(
        probeSignedMacBuild('/Applications/Other.app/Contents/MacOS/Other', {
          expectedIdentifier: 'com.pluto.app',
          spawn: spawn as never,
        }),
      ).toMatchObject({
        valid: false,
        reason: 'signature_identifier_mismatch',
      });
    });
  },
);
