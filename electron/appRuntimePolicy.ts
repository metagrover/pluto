import path from 'node:path';

export const PLUTO_PRODUCT_NAME = 'Pluto';
export const PLUTO_BUNDLE_IDENTIFIER = 'com.pluto.app';

export const shouldAcquireProductionInstanceLock = (
  isPackaged: boolean,
): boolean => isPackaged;

export const resolveDevelopmentUserDataDir = ({
  explicit,
  tempDir,
  productionDir,
  allowProductionRecovery = false,
}: {
  explicit?: string;
  tempDir: string;
  productionDir?: string;
  allowProductionRecovery?: boolean;
}): string => {
  const resolved =
    explicit?.trim() || path.join(tempDir, 'pluto-development-profile');
  if (
    !allowProductionRecovery &&
    productionDir &&
    path.resolve(resolved) === path.resolve(productionDir)
  ) {
    throw new Error(
      'Development Electron cannot open the Pluto production profile. Launch the signed Pluto app instead.',
    );
  }
  return resolved;
};

export const resolveProductionUserDataDir = (input: {
  platform: string;
  homeDir: string;
}): string | null =>
  input.platform === 'darwin'
    ? path.join(input.homeDir, 'Library', 'Application Support', 'pluto')
    : null;

export const canOpenProductionDatabase = (input: {
  isPackaged: boolean;
  signedBuildValid: boolean;
  targetsProductionProfile?: boolean;
  recoveryKeyAvailable?: boolean;
}): boolean =>
  input.isPackaged
    ? input.signedBuildValid
    : !input.targetsProductionProfile || Boolean(input.recoveryKeyAvailable);

export const resolveUserDataArgument = (argv: string[]): string | null => {
  const prefix = '--user-data-dir=';
  const value = argv.find((argument) => argument.startsWith(prefix));
  const resolved = value?.slice(prefix.length).trim();
  return resolved || null;
};
