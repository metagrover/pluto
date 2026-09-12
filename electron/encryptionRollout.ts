import { spawnSync } from 'node:child_process';

export const ENCRYPTION_ROLLOUT_ENV = 'PLUTO_ENCRYPTION_ROLLOUT';
export const HISTORICAL_AUDIO_MIGRATION_ENV =
  'PLUTO_HISTORICAL_AUDIO_MIGRATION';
export const AUDIO_RETENTION_ENFORCEMENT_ENV =
  'PLUTO_AUDIO_RETENTION_ENFORCEMENT';

export type EncryptionRolloutPolicy = {
  mode: 'off' | 'signed_canary';
  encryptedCaptureWrites: boolean;
  encryptedNativeReads: true;
  historicalAudioMigration: boolean;
  retentionEnforcement: boolean;
  reason: string;
};

export type SignedBuildProbe = {
  valid: boolean;
  reason: string;
  identifier?: string;
  teamIdentifier?: string;
};

export const probeSignedMacBuild = (
  executablePath: string,
  options: {
    expectedIdentifier?: string;
    spawn?: typeof spawnSync;
  } = {},
): SignedBuildProbe => {
  if (process.platform !== 'darwin') {
    return { valid: false, reason: 'platform_unsupported' };
  }
  const spawn = options.spawn ?? spawnSync;
  const verified = spawn(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', executablePath],
    { encoding: 'utf8' },
  );
  if (verified.status !== 0) {
    return { valid: false, reason: 'signature_invalid' };
  }
  const details = spawn(
    '/usr/bin/codesign',
    ['--display', '--verbose=4', executablePath],
    { encoding: 'utf8' },
  );
  const output = `${details.stdout || ''}\n${details.stderr || ''}`;
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim();
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim();
  if (
    details.status !== 0 ||
    /Signature=adhoc/i.test(output) ||
    !/^Authority=.+$/m.test(output) ||
    !teamIdentifier ||
    teamIdentifier === 'not set'
  ) {
    return { valid: false, reason: 'signature_not_distribution_bound' };
  }
  if (options.expectedIdentifier && identifier !== options.expectedIdentifier) {
    return {
      valid: false,
      reason: 'signature_identifier_mismatch',
      identifier,
      teamIdentifier,
    };
  }
  return {
    valid: true,
    reason: 'signed_distribution_build',
    identifier,
    teamIdentifier,
  };
};

export const resolveEncryptionRolloutPolicy = (input: {
  isPackaged: boolean;
  requestedMode?: string;
  historicalMigrationRequested?: string;
  retentionEnforcementRequested?: string;
  signedBuild: SignedBuildProbe;
}): EncryptionRolloutPolicy => {
  const signedCanaryRequested = input.requestedMode === 'signed_canary';
  if (!signedCanaryRequested) {
    return {
      mode: 'off',
      encryptedCaptureWrites: false,
      encryptedNativeReads: true,
      historicalAudioMigration: false,
      retentionEnforcement: false,
      reason: 'rollout_not_requested',
    };
  }
  if (!input.isPackaged) {
    return {
      mode: 'off',
      encryptedCaptureWrites: false,
      encryptedNativeReads: true,
      historicalAudioMigration: false,
      retentionEnforcement: false,
      reason: 'packaged_build_required',
    };
  }
  if (!input.signedBuild.valid) {
    return {
      mode: 'off',
      encryptedCaptureWrites: false,
      encryptedNativeReads: true,
      historicalAudioMigration: false,
      retentionEnforcement: false,
      reason: input.signedBuild.reason,
    };
  }
  return {
    mode: 'signed_canary',
    encryptedCaptureWrites: true,
    encryptedNativeReads: true,
    historicalAudioMigration: input.historicalMigrationRequested === '1',
    retentionEnforcement: input.retentionEnforcementRequested === '1',
    reason: 'signed_canary_enabled',
  };
};
