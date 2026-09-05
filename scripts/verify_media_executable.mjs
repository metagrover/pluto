import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Inspect before execution: a mislabeled Intel tool must never trigger Rosetta.
export const verifyMediaExecutable = async (
  executablePath,
  name,
  { architecture = process.arch, run = promisify(execFile) } = {},
) => {
  if (process.platform === 'darwin') {
    try {
      await run('/usr/bin/lipo', [
        executablePath,
        '-verify_arch',
        architecture === 'x64' ? 'x86_64' : architecture,
      ]);
    } catch {
      throw new Error(
        `Media executable architecture mismatch: expected ${architecture}: ${executablePath}`,
      );
    }
    const { stdout: linkage } = await run('/usr/bin/otool', [
      '-L',
      executablePath,
    ]);
    const dependencies = linkage
      .split('\n')
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => line.trim().split(' (')[0]);
    if (
      dependencies.some(
        (dependency) =>
          !dependency.startsWith('/System/Library/') &&
          !dependency.startsWith('/usr/lib/'),
      )
    ) {
      throw new Error(
        `Media executable has nonportable library dependencies: ${executablePath}`,
      );
    }
  }
  const { stdout } = await run(executablePath, ['-version'], {
    timeout: 30000,
  });
  if (!stdout.startsWith(`${name} version`)) {
    throw new Error(`Media executable returned an unexpected version: ${name}`);
  }
};
