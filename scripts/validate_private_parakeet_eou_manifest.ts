import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import ffprobeStatic from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';

export type PrivateParakeetEouSource = {
  path: string;
  sha256: string;
};

export type PrivateParakeetEouManifest = {
  schemaVersion: 1;
  approvedPrivateRoot: string;
  expectedDurationSeconds: number;
  sources: {
    mic: PrivateParakeetEouSource;
    system: PrivateParakeetEouSource;
  };
};

export type PrivateParakeetEouValidationAdapters = {
  lstat(filePath: string): Stats;
  realpath(filePath: string): string;
  sha256File(filePath: string): string;
  probeAudio(filePath: string): {
    durationSeconds: number;
    monoConvertible: boolean;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
) => {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
};

const PRIVATE_CONTENT_KEY =
  /^(?:transcript|text|words?|tokens?|segments?|content|audioData|pcm|pcmData|samples?|speaker|identity)$/iu;

const rejectPrivateContent = (value: unknown, key = ''): void => {
  if (PRIVATE_CONTENT_KEY.test(key))
    throw new Error('private_content_not_allowed');
  if (Array.isArray(value)) {
    for (const entry of value) rejectPrivateContent(entry);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    rejectPrivateContent(child, childKey);
  }
};

const isStrictDescendant = (candidate: string, root: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
};

const hasSymlinkAncestor = (
  filePath: string,
  lstat: (value: string) => Stats,
) => {
  const normalized = path.normalize(filePath);
  const parsed = path.parse(normalized);
  let ancestor = parsed.root;
  for (const part of path
    .relative(parsed.root, normalized)
    .split(path.sep)
    .filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    if (lstat(ancestor).isSymbolicLink()) return true;
  }
  return false;
};

const sha256File = (filePath: string) => {
  const digest = createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
};

const probeAudio = (filePath: string) => {
  const durationProbe = spawnSync(
    ffprobeStatic.path,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const durationSeconds = Number(durationProbe.stdout?.trim());
  const convertible = ffmpegStatic
    ? spawnSync(
        ffmpegStatic,
        [
          '-v',
          'error',
          '-t',
          '1',
          '-i',
          filePath,
          '-map',
          '0:a:0',
          '-ac',
          '1',
          '-f',
          'null',
          '-',
        ],
        { timeout: 30_000, stdio: 'ignore' },
      ).status === 0
    : false;
  return {
    durationSeconds,
    monoConvertible:
      durationProbe.status === 0 &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0 &&
      convertible,
  };
};

const DEFAULT_ADAPTERS: PrivateParakeetEouValidationAdapters = {
  lstat: fs.lstatSync,
  realpath: fs.realpathSync,
  sha256File,
  probeAudio,
};

export const validatePrivateParakeetEouManifest = (
  raw: unknown,
  adapters: PrivateParakeetEouValidationAdapters = DEFAULT_ADAPTERS,
  roots: { homeRoot?: string; workspaceRoot?: string } = {},
): PrivateParakeetEouManifest => {
  rejectPrivateContent(raw);
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, [
      'schemaVersion',
      'approvedPrivateRoot',
      'expectedDurationSeconds',
      'sources',
    ]) ||
    raw.schemaVersion !== 1 ||
    typeof raw.approvedPrivateRoot !== 'string' ||
    !path.isAbsolute(raw.approvedPrivateRoot) ||
    typeof raw.expectedDurationSeconds !== 'number' ||
    !Number.isFinite(raw.expectedDurationSeconds) ||
    raw.expectedDurationSeconds <= 0 ||
    !isRecord(raw.sources) ||
    !hasExactKeys(raw.sources, ['mic', 'system'])
  ) {
    throw new Error('manifest_invalid');
  }

  const homeRoot = path.normalize(roots.homeRoot ?? os.homedir());
  const workspaceRoot = path.normalize(roots.workspaceRoot ?? process.cwd());
  let approvedPrivateRoot: string;
  try {
    const normalized = path.normalize(raw.approvedPrivateRoot);
    const parsed = path.parse(normalized);
    if (
      normalized === parsed.root ||
      normalized === homeRoot ||
      normalized === workspaceRoot ||
      isStrictDescendant(normalized, workspaceRoot) ||
      hasSymlinkAncestor(normalized, adapters.lstat) ||
      !adapters.lstat(normalized).isDirectory()
    ) {
      throw new Error('private_root_unsafe');
    }
    approvedPrivateRoot = adapters.realpath(normalized);
    if (approvedPrivateRoot !== normalized)
      throw new Error('private_root_unsafe');
  } catch (error) {
    if (error instanceof Error && error.message === 'private_root_unsafe')
      throw error;
    throw new Error('private_root_unsafe');
  }

  const expectedDurationSeconds = raw.expectedDurationSeconds;
  const validated = {} as PrivateParakeetEouManifest['sources'];
  for (const source of ['mic', 'system'] as const) {
    const entry = raw.sources[source];
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ['path', 'sha256']) ||
      typeof entry.path !== 'string' ||
      !path.isAbsolute(entry.path) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error('manifest_invalid');
    }
    let canonicalPath: string;
    try {
      const normalized = path.normalize(entry.path);
      if (
        !isStrictDescendant(normalized, approvedPrivateRoot) ||
        hasSymlinkAncestor(normalized, adapters.lstat) ||
        !adapters.lstat(normalized).isFile()
      ) {
        throw new Error('source_unavailable');
      }
      canonicalPath = adapters.realpath(normalized);
      if (canonicalPath !== normalized) throw new Error('source_unavailable');
    } catch {
      throw new Error('source_unavailable');
    }
    if (adapters.sha256File(canonicalPath) !== entry.sha256) {
      throw new Error('source_digest_mismatch');
    }
    const audio = adapters.probeAudio(canonicalPath);
    if (!audio.monoConvertible) throw new Error('source_not_convertible');
    const toleranceSeconds = Math.max(0.5, expectedDurationSeconds * 0.01);
    if (
      !Number.isFinite(audio.durationSeconds) ||
      Math.abs(audio.durationSeconds - expectedDurationSeconds) >
        toleranceSeconds
    ) {
      throw new Error('source_duration_mismatch');
    }
    validated[source] = { path: canonicalPath, sha256: entry.sha256 };
  }
  if (validated.mic.path === validated.system.path) {
    throw new Error('source_not_independent');
  }
  return {
    schemaVersion: 1,
    approvedPrivateRoot,
    expectedDurationSeconds,
    sources: validated,
  };
};

export const readPrivateParakeetEouManifest = (
  manifestPath: string,
): PrivateParakeetEouManifest => {
  if (!path.isAbsolute(manifestPath)) throw new Error('manifest_unavailable');
  try {
    if (hasSymlinkAncestor(manifestPath, fs.lstatSync)) {
      throw new Error('manifest_unavailable');
    }
    const normalized = path.normalize(manifestPath);
    if (
      !fs.lstatSync(normalized).isFile() ||
      fs.realpathSync(normalized) !== normalized
    ) {
      throw new Error('manifest_unavailable');
    }
    return validatePrivateParakeetEouManifest(
      JSON.parse(fs.readFileSync(normalized, 'utf8')),
    );
  } catch (error) {
    if (error instanceof Error && error.message !== 'manifest_unavailable')
      throw error;
    throw new Error('manifest_unavailable');
  }
};

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isCli) {
  try {
    const manifestIndex = process.argv.indexOf('--manifest');
    const manifestPath = process.argv[manifestIndex + 1];
    if (manifestIndex < 0 || !manifestPath)
      throw new Error('manifest_unavailable');
    const manifest = readPrivateParakeetEouManifest(path.resolve(manifestPath));
    process.stdout.write(
      `${JSON.stringify({ ready: true, sourceCount: 2, durationSeconds: manifest.expectedDurationSeconds })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ready: false, error: error instanceof Error ? error.message : 'manifest_invalid' })}\n`,
    );
    process.exitCode = 1;
  }
}
