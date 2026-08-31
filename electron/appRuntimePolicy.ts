import path from 'node:path';

export const shouldAcquireProductionInstanceLock = (
  isPackaged: boolean,
): boolean => isPackaged;

export const resolveDevelopmentUserDataDir = ({
  explicit,
  tempDir,
}: {
  explicit?: string;
  tempDir: string;
}): string =>
  explicit?.trim() || path.join(tempDir, 'pluto-development-profile');

export const resolveUserDataArgument = (argv: string[]): string | null => {
  const prefix = '--user-data-dir=';
  const value = argv.find((argument) => argument.startsWith(prefix));
  const resolved = value?.slice(prefix.length).trim();
  return resolved || null;
};
