import path from 'node:path';

export const PLUTO_PRODUCT_NAME = 'Pluto';
export const PLUTO_BUNDLE_IDENTIFIER = 'com.pluto.app';

export const resolveDevelopmentUserDataDir = ({
  explicit,
  tempDir,
  productionDir,
}: {
  explicit?: string;
  tempDir: string;
  productionDir?: string;
}): string =>
  explicit?.trim() ||
  productionDir ||
  path.join(tempDir, 'pluto-development-profile');

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
  allowUnsignedPackaged?: boolean;
}): boolean =>
  !input.isPackaged ||
  input.signedBuildValid ||
  Boolean(input.allowUnsignedPackaged);

export const resolveUserDataArgument = (argv: string[]): string | null => {
  const prefix = '--user-data-dir=';
  const value = argv.find((argument) => argument.startsWith(prefix));
  const resolved = value?.slice(prefix.length).trim();
  return resolved || null;
};
