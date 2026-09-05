import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { verifyMediaExecutable } from '../../scripts/verify_media_executable.mjs';

afterEach(() => vi.restoreAllMocks());

it('rejects an Intel Mach-O before attempting to launch it', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pluto-intel-header-'));
  try {
    const binary = path.join(root, 'ffprobe');
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x01000007, 4);
    header.writeUInt32LE(3, 8);
    header.writeUInt32LE(2, 12);
    writeFileSync(binary, header, { mode: 0o755 });
    await expect(
      verifyMediaExecutable(binary, 'ffprobe', { architecture: 'arm64' }),
    ).rejects.toThrow('architecture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('checks architecture and portable linkage before invoking the binary', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: '' })
    .mockResolvedValueOnce({
      stdout:
        '/binary:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n',
    })
    .mockResolvedValueOnce({ stdout: 'ffprobe version 5\n' });
  await verifyMediaExecutable('/binary', 'ffprobe', {
    architecture: 'arm64',
    run,
  });
  expect(run).toHaveBeenNthCalledWith(1, '/usr/bin/lipo', [
    '/binary',
    '-verify_arch',
    'arm64',
  ]);
  expect(run.mock.calls.map(([command]) => command)).toEqual([
    '/usr/bin/lipo',
    '/usr/bin/otool',
    '/binary',
  ]);
});

it('rejects Homebrew-linked binaries before invoking them', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: '' })
    .mockResolvedValueOnce({
      stdout:
        '/binary:\n\t/opt/homebrew/lib/libavcodec.dylib (compatibility version 1.0.0)\n',
    });
  await expect(
    verifyMediaExecutable('/binary', 'ffprobe', { architecture: 'arm64', run }),
  ).rejects.toThrow('nonportable');
  expect(run).toHaveBeenCalledTimes(2);
});
