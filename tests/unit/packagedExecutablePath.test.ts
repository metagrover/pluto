import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { resolveUnpackedExecutablePath } from '../../electron/packagedExecutablePath';

describe('packaged media executable paths', () => {
  it('uses the unpacked archive path without rewriting development or already-unpacked paths', () => {
    expect(
      resolveUnpackedExecutablePath(
        '/Applications/Pluto.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg',
      ),
    ).toBe(
      '/Applications/Pluto.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    );
    expect(
      resolveUnpackedExecutablePath(
        'C:\\Pluto\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe',
      ),
    ).toBe(
      'C:\\Pluto\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe',
    );
    for (const file of [
      '/dev/app.asar-build/node_modules/ffmpeg-static/ffmpeg',
      '/dev/node_modules/ffmpeg-static/ffmpeg',
      '/app/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    ])
      expect(resolveUnpackedExecutablePath(file)).toBe(file);
  });

  it.each([
    ['ffmpeg', ffmpegStatic!],
    ['ffprobe', ffprobeStatic.path],
  ])('executes %s outside a real archive file', (name, installedBinary) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pluto-media-package-'));
    try {
      writeFileSync(path.join(root, 'app.asar'), 'archive file');
      const relativeBinary = path.join(
        'node_modules',
        name === 'ffprobe'
          ? `@ffprobe-installer/${process.platform}-${process.arch}`
          : 'ffmpeg-static',
        path.basename(installedBinary),
      );
      const unpackedPath = path.join(root, 'app.asar.unpacked', relativeBinary);
      mkdirSync(path.dirname(unpackedPath), { recursive: true });
      symlinkSync(installedBinary, unpackedPath);
      const executable = resolveUnpackedExecutablePath(
        path.join(root, 'app.asar', relativeBinary),
      );
      expect(
        execFileSync(executable, ['-version'], {
          encoding: 'utf8',
          timeout: 10000,
        }),
      ).toContain(`${name} version`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
