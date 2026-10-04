import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  it('cleans packaging output without removing a running development preload', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pluto-build-'));
    try {
      for (const directory of ['dist-electron', 'dist-electron-package']) {
        await mkdir(path.join(temporaryRoot, directory));
        await writeFile(
          path.join(temporaryRoot, directory, 'preload.js'),
          directory,
        );
      }
      await execFileAsync(
        process.execPath,
        [path.join(projectRoot, 'scripts/clean_generated_electron_output.mjs')],
        { cwd: temporaryRoot },
      );
      expect(
        readFileSync(
          path.join(temporaryRoot, 'dist-electron/preload.js'),
          'utf8',
        ),
      ).toBe('dist-electron');
      expect(
        existsSync(path.join(temporaryRoot, 'dist-electron-package')),
      ).toBe(false);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
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

  it.each(['valid', 'missing', 'unlaunchable', 'intel', 'missing-microphone'])(
    'checks executable media tools with an explicit app path (tools: %s)',
    async (mediaToolState) => {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pluto-app-'));
      const appPath = path.join(temporaryRoot, 'Pluto.app');
      const binPath = path.join(appPath, 'Contents', 'Resources', 'bin');
      const contents = path.join(appPath, 'Contents');
      await mkdir(path.join(contents, 'MacOS'), { recursive: true });
      await mkdir(path.join(contents, 'Resources'), { recursive: true });
      await copyFile('/usr/bin/true', path.join(contents, 'MacOS', 'Pluto'));
      await copyFile(
        path.join(projectRoot, 'build/pluto.icns'),
        path.join(contents, 'Resources/icon.icns'),
      );
      await writeFile(
        path.join(contents, 'Info.plist'),
        `<?xml version="1.0"?><plist version="1.0"><dict>
        <key>CFBundleExecutable</key><string>Pluto</string>
        <key>CFBundleIdentifier</key><string>com.pluto.fixture</string>
        <key>CFBundlePackageType</key><string>APPL</string>
        <key>CFBundleIconFile</key><string>icon.icns</string>
        <key>NSMicrophoneUsageDescription</key><string>Fixture audio</string>
        <key>NSAudioCaptureUsageDescription</key><string>Fixture system audio</string>
        <key>NSCalendarsFullAccessUsageDescription</key><string>Fixture calendar</string>
      </dict></plist>`,
      );

      for (const relativePath of [
        'audiocap',
        'parakeet-runtime',
        'parakeet-resource-probe',
        'PlutoCalendarHelper.app/Contents/MacOS/PlutoCalendarHelper',
      ]) {
        const executable = path.join(binPath, relativePath);
        await mkdir(path.dirname(executable), { recursive: true });
        await copyFile('/usr/bin/true', executable);
        await chmod(executable, 0o755);
      }
      const helperInfoPath = path.join(
        binPath,
        'PlutoCalendarHelper.app/Contents/Info.plist',
      );
      await mkdir(path.dirname(helperInfoPath), { recursive: true });
      await writeFile(
        helperInfoPath,
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>PlutoCalendarHelper</string><key>CFBundleIdentifier</key><string>com.pluto.fixture.calendar</string><key>CFBundlePackageType</key><string>APPL</string><key>NSCalendarsFullAccessUsageDescription</key><string>Fixture calendar</string></dict></plist>',
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
          if (
            mediaToolState === 'valid' ||
            mediaToolState === 'missing-microphone'
          )
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
      await execFileAsync('codesign', [
        '--force',
        '--sign',
        '-',
        path.join(binPath, 'PlutoCalendarHelper.app'),
      ]);
      const entitlementPath =
        mediaToolState === 'missing-microphone'
          ? path.join(temporaryRoot, 'empty-entitlements.plist')
          : path.join(projectRoot, 'build/entitlements.mac.plist');
      if (mediaToolState === 'missing-microphone') {
        await writeFile(
          entitlementPath,
          '<?xml version="1.0"?><plist version="1.0"><dict/></plist>',
        );
      }
      await execFileAsync('codesign', [
        '--force',
        '--sign',
        '-',
        '--entitlements',
        entitlementPath,
        appPath,
      ]);
      try {
        const verification = execFileAsync(process.execPath, [
          path.join(projectRoot, 'scripts/verify_packaged_runtime.mjs'),
          '--',
          appPath,
        ]);
        if (mediaToolState === 'valid')
          await expect(verification).resolves.toMatchObject({
            stdout: 'Verified Pluto icon and 6 packaged runtimes.\n',
          });
        else if (mediaToolState === 'missing-microphone')
          await expect(verification).rejects.toThrow(
            'lacks microphone entitlement',
          );
        else if (mediaToolState === 'intel')
          await expect(verification).rejects.toThrow('architecture mismatch');
        else await expect(verification).rejects.toThrow();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );
});
