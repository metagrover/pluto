import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSwiftBinPath } from '../../scripts/lib/swift_bin_path.mjs';

const temporaryDirectories = [];

const makeBuildTree = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-swift-bin-'));
  temporaryDirectories.push(root);
  const buildRoot = path.join(root, '.build');
  const binPath = path.join(buildRoot, 'arm64-apple-macosx', 'release');
  fs.mkdirSync(binPath, { recursive: true });
  return { root, buildRoot, binPath };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveSwiftBinPath', () => {
  it('uses the final non-empty path after noisy Swift planning output', () => {
    const { buildRoot, binPath } = makeBuildTree();

    expect(
      resolveSwiftBinPath(`Planning build\n\n${binPath}\n`, buildRoot),
    ).toBe(fs.realpathSync(binPath));
  });

  it('rejects a canonical path outside the package build root', () => {
    const { buildRoot, root } = makeBuildTree();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);

    expect(() => resolveSwiftBinPath(outside, buildRoot)).toThrow(
      'swift_bin_path_outside_build_root',
    );
  });

  it('rejects a symlink that escapes the package build root', () => {
    const { buildRoot, root } = makeBuildTree();
    const outside = path.join(root, 'outside');
    const escaped = path.join(buildRoot, 'escaped');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, escaped);

    expect(() => resolveSwiftBinPath(escaped, buildRoot)).toThrow(
      'swift_bin_path_outside_build_root',
    );
  });

  it('fails closed for empty, relative, and missing output paths', () => {
    const { buildRoot } = makeBuildTree();

    expect(() => resolveSwiftBinPath('\n', buildRoot)).toThrow(
      'swift_bin_path_missing',
    );
    expect(() => resolveSwiftBinPath('release', buildRoot)).toThrow(
      'swift_bin_path_not_absolute',
    );
    expect(() =>
      resolveSwiftBinPath(path.join(buildRoot, 'missing'), buildRoot),
    ).toThrow('swift_bin_path_unresolvable');
  });
});
