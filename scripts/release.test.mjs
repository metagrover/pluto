import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { nextVersion, normalizeVersion, releaseNotes } from './release.mjs';

test('version policy handles RC, stable, explicit bumps, and legacy tags', () => {
  assert.equal(nextVersion('1.0.0-rc.3'), '1.0.0-rc.4');
  assert.equal(nextVersion('1.0.0'), '1.0.1');
  assert.equal(nextVersion('1.0.0-rc.3', 'stable'), '1.0.0');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', 'rc'), '1.2.4-rc.1');
  assert.equal(nextVersion('1.2.3-rc.9', 'patch'), '1.2.4');
  assert.equal(normalizeVersion('v1.0.0.rc.3'), '1.0.0-rc.3');
  assert.throws(() => nextVersion('1.2.3', 'stable'));
  assert.throws(() => nextVersion('01.2.3'));
  assert.throws(() => nextVersion('1.2.3-beta.1'));
  assert.throws(() => nextVersion('1.2.3', 'unknown'));
});

test('release notes include direct changes, evidence links, and installation', () => {
  const notes = releaseNotes(
    '1.0.0-rc.4',
    'v1.0.0.rc.3',
    [{ hash: '1234567890', subject: 'Fix model cache reuse' }],
    'example/pluto',
  );
  assert.match(notes, /Release candidate for testing/);
  assert.match(notes, /Fix model cache reuse/);
  assert.match(notes, /example\/pluto\/commit\/1234567890/);
  assert.match(notes, /compare\/v1.0.0.rc.3\.\.\.v1.0.0-rc.4/);
  assert.match(notes, /SHA256SUMS.txt/);
  assert.match(notes, /not notarized/);
  assert.match(notes, /curl -fsSL/);
  assert.match(notes, /gh api/);
  assert.match(notes, /install-macos\.sh/);
  assert.doesNotMatch(notes, /xattr -cr|spctl --master-disable/);
});

test('CLI preview is read-only and blocks unsafe releases', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'pluto-release-test-'));
  const script = resolve('scripts/release.mjs');
  const cwd = resolve(root, 'repo');
  const bin = resolve(root, 'bin');
  mkdirSync(cwd);
  mkdirSync(bin);
  writeFileSync(
    resolve(bin, 'gh'),
    '#!/bin/sh\nif [ "$1" = auth ]; then exit 0; fi\nif [ "$1" = api ]; then exit 1; fi\nprintf \'{"nameWithOwner":"example/pluto","defaultBranchRef":{"name":"master"}}\'\n',
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LEFTHOOK: '0',
  };
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const preview = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    execFileSync('git', ['init', '--bare', resolve(root, 'origin.git')], {
      env,
      stdio: 'ignore',
    });
    git('init', '-b', 'master');
    git('config', 'user.name', 'Release Test');
    git('config', 'user.email', 'release-test@example.invalid');
    git('remote', 'add', 'origin', resolve(root, 'origin.git'));
    const pkg = '{"version":"1.0.0-rc.3"}\n';
    writeFileSync(resolve(cwd, 'package.json'), pkg);
    git('add', '.');
    git('commit', '-m', 'Initial release');
    git('tag', 'v1.0.0.rc.3');
    git('push', '-u', 'origin', 'master', '--tags');
    assert.throws(() => preview('--dry-run'), /No changes since/);
    assert.match(
      preview('stable', '--dry-run'),
      /to stable with no additional code changes/,
    );
    writeFileSync(resolve(cwd, 'fix.txt'), 'Neutral fixture\n');
    assert.throws(() => preview('--dry-run'), /clean checkout/);
    git('add', '.');
    git('commit', '-m', 'Fix restart cache reuse');
    assert.throws(() => preview('--dry-run'), /must match origin/);
    git('push', 'origin', 'master');
    const head = git('rev-parse', 'HEAD');
    const tags = git('tag', '--list');
    const output = preview('--dry-run');
    assert.match(output, /1.0.0-rc.3 → 1.0.0-rc.4/);
    assert.match(output, /Fix restart cache reuse/);
    assert.doesNotMatch(output, /Initial release/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('tag', '--list'), tags);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(readFileSync(resolve(cwd, 'package.json'), 'utf8'), pkg);
    assert.throws(() => preview(), /Actions read access/);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('tag', '--list'), tags);
    git('tag', 'v1.0.0.rc.4');
    assert.throws(() => preview('--dry-run'), /already exists/);
    git('tag', '-d', 'v1.0.0.rc.4');
    git('switch', '-c', 'codex/fixture');
    assert.throws(() => preview('--dry-run'), /Release from master/);
    assert.throws(() => preview('--typo'), /Unknown argument/);
    // Exercise the actual commit/tag/atomic-push path against a disposable
    // local origin. GitHub and pnpm are stubbed; nothing can publish online.
    git('switch', 'master');
    writeFileSync(
      resolve(bin, 'gh'),
      `#!/bin/sh
case "$1 $2" in
  "auth status"|"run watch") exit 0 ;;
  "repo view") printf '{"nameWithOwner":"example/pluto","defaultBranchRef":{"name":"master"}}' ;;
  "api "*) printf active ;;
  "run list") printf '[{"databaseId":42,"headBranch":"v1.0.0-rc.4"}]' ;;
  "release view") printf 'https://github.com/example/pluto/releases/tag/v1.0.0-rc.4' ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(resolve(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.match(preview(), /releases\/tag\/v1.0.0-rc.4/);
    assert.equal(
      JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version,
      '1.0.0-rc.4',
    );
    assert.match(
      readFileSync(resolve(cwd, 'docs/releases/v1.0.0-rc.4.md'), 'utf8'),
      /Fix restart cache reuse/,
    );
    const released = git('rev-parse', 'HEAD');
    assert.equal(git('rev-parse', 'v1.0.0-rc.4^{}'), released);
    assert.equal(git('rev-parse', 'origin/master'), released);
    assert.equal(git('status', '--porcelain'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
