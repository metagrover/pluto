import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const resolveSwiftBinPath = (output, expectedBuildRoot) => {
  const candidate = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!candidate) throw new Error('swift_bin_path_missing');
  if (!path.isAbsolute(candidate)) {
    throw new Error('swift_bin_path_not_absolute');
  }

  let canonicalRoot;
  let canonicalCandidate;
  try {
    canonicalRoot = fs.realpathSync(expectedBuildRoot);
    canonicalCandidate = fs.realpathSync(candidate);
  } catch {
    throw new Error('swift_bin_path_unresolvable');
  }

  if (!canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error('swift_bin_path_outside_build_root');
  }
  return canonicalCandidate;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      resolveSwiftBinPath(fs.readFileSync(0, 'utf8'), process.argv[2]),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'swift_bin_path_invalid'}\n`,
    );
    process.exitCode = 1;
  }
}
