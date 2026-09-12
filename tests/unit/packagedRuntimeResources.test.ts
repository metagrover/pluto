import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';

import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

describe('packaged runtime resources', () => {
  it('builds the calendar helper in native and distributable builds', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['build-native']).toContain(
      'pnpm run build:calendar-helper',
    );
    expect(packageJson.scripts.build).toContain('pnpm run build-native');
  });

  it('verifies native portable media tools before development and packaging', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    );
    expect(packageJson.scripts['ensure:dev-runtime']).toContain(
      'pnpm run ensure:media-tools',
    );
    expect(packageJson.scripts['build-native']).toContain(
      'pnpm run ensure:media-tools',
    );
    expect(packageJson.scripts['ensure:media-tools']).toBe(
      'node scripts/verify_media_runtime.mjs',
    );
    expect(packageJson.dependencies['@ffprobe-installer/ffprobe']).toBe(
      '2.1.2',
    );
    const config = readFileSync(
      path.join(projectRoot, 'electron-builder.json5'),
      'utf8',
    );
    expect(config).toContain('node_modules/@ffprobe-installer/**');
    const workspace = readFileSync(
      path.join(projectRoot, 'pnpm-workspace.yaml'),
      'utf8',
    );
    expect(workspace).toContain('@ffprobe-installer/darwin-arm64');
    expect(workspace).toContain('@ffprobe-installer/darwin-x64');
  });

  it('copies every production runtime from resources/bin', () => {
    const config = readFileSync(
      path.join(projectRoot, 'electron-builder.json5'),
      'utf8',
    );

    expect(config).toMatch(
      /"from": "resources\/bin"[^}]*"to": "bin"[^}]*"filter": \["\*\*\/\*", "!recorder"\]/,
    );
    expect(config).toContain('"!recorder"');
  });

  it('provides a packaged artifact verifier', () => {
    const verifier = readFileSync(
      path.join(projectRoot, 'scripts/verify_packaged_runtime.mjs'),
      'utf8',
    );

    for (const runtime of [
      'audiocap',
      'parakeet-runtime',
      'parakeet-resource-probe',
      'PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
      'NSCalendarsFullAccessUsageDescription',
    ]) {
      expect(verifier).toContain(runtime);
    }
  });

  it.each(['valid', 'missing', 'unlaunchable', 'intel'])(
    'checks executable media tools with an explicit app path (tools: %s)',
    async (mediaToolState) => {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pluto-app-'));
      const appPath = path.join(temporaryRoot, 'Pluto.app');
      const binPath = path.join(appPath, 'Contents', 'Resources', 'bin');
      for (const relativePath of [
        'audiocap',
        'parakeet-runtime',
        'parakeet-resource-probe',
        'PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
      ]) {
        const executable = path.join(binPath, relativePath);
        await mkdir(path.dirname(executable), { recursive: true });
        await writeFile(executable, 'fixture');
        await chmod(executable, 0o755);
      }
      const helperInfoPath = path.join(
        binPath,
        'PlutoCalendarHelper.app/Contents/Info.plist',
      );
      await mkdir(path.dirname(helperInfoPath), { recursive: true });
      await writeFile(
        helperInfoPath,
        '<key>NSCalendarsFullAccessUsageDescription</key>',
      );

      const nodeModules = path.join(
        appPath,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
      );
      if (mediaToolState !== 'missing') {
        for (const [relative, installed] of [
          [
            path.join('ffmpeg-static', path.basename(ffmpegStatic!)),
            ffmpegStatic!,
          ],
          [
            path.join(
              '@ffprobe-installer',
              `${process.platform}-${process.arch}`,
              path.basename(ffprobeStatic.path),
            ),
            ffprobeStatic.path,
          ],
        ]) {
          const destination = path.join(nodeModules, relative);
          await mkdir(path.dirname(destination), { recursive: true });
          if (mediaToolState === 'valid')
            await copyFile(installed, destination);
          else {
            const header = Buffer.alloc(32);
            header.writeUInt32LE(0xfeedfacf, 0);
            header.writeUInt32LE(0x01000007, 4);
            header.writeUInt32LE(3, 8);
            header.writeUInt32LE(2, 12);
            await writeFile(
              destination,
              mediaToolState === 'intel' ? header : '#!/bin/sh\nexit 23\n',
            );
            await chmod(destination, 0o755);
          }
        }
      }
      try {
        const verification = execFileAsync(process.execPath, [
          path.join(projectRoot, 'scripts/verify_packaged_runtime.mjs'),
          '--',
          appPath,
        ]);
        if (mediaToolState === 'valid')
          await expect(verification).resolves.toMatchObject({
            stdout: 'Verified 6 packaged runtimes.\n',
          });
        else if (mediaToolState === 'intel')
          await expect(verification).rejects.toThrow('architecture mismatch');
        else await expect(verification).rejects.toThrow();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );
});
