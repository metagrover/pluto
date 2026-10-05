import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/install-macos.sh');
test(
  'installer verifies before replacement, preserves data, and recovers failed upgrades',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'pluto-install-test-'));
    const bin = join(root, 'bin');
    const asset = join(root, 'asset');
    const applications = join(root, 'Applications');
    const log = join(root, 'actions');
    const app = join(applications, 'Pluto.app');
    for (const dir of [
      bin,
      asset,
      applications,
      join(asset, 'Pluto.app', 'Contents'),
    ])
      mkdirSync(dir, { recursive: true });
    const info = {
      CFBundleIdentifier: 'com.pluto.app',
      CFBundleShortVersionString: '1.0.0-rc.6',
    };
    writeFileSync(
      join(asset, 'Pluto.app', 'Contents', 'Info.plist'),
      JSON.stringify(info),
    );
    writeFileSync(join(asset, 'Pluto.app', 'new'), 'new app');
    const filename = 'Pluto-Mac-1.0.0-rc.6-Installer.dmg';
    writeFileSync(join(asset, filename), 'neutral installer fixture');
    const digest = createHash('sha256')
      .update('neutral installer fixture')
      .digest('hex');
    writeFileSync(join(asset, 'SHA256SUMS.txt'), `${digest}  ${filename}\n`);
    const stub = (name, body) =>
      writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, {
        mode: 0o755,
      });
    stub('uname', 'if [[ $1 == -s ]]; then echo Darwin; else echo arm64; fi');
    stub('sw_vers', 'echo 26.5.2');
    stub('pgrep', 'exit "${TEST_RUNNING:-1}"');
    stub(
      'curl',
      `[[ \${TEST_PUBLIC:-0} == 1 ]] || exit 22
while [[ $# -gt 0 ]]; do
 case "$1" in
  -o) target=$2; shift 2 ;;
  https://*) url=$1; shift ;;
  *) shift ;;
 esac
done
case "$url" in
 *api.github.com*) printf '[{"tag_name":"%s"}]' "\${TEST_LATEST_TAG:-v1.0.0-rc.6}" > "$target" ;;
 *) cp "$TEST_ASSET/\${url##*/}" "$target" ;;
esac`,
    );
    stub(
      'gh',
      `if [[ "$1 $2" == 'release list' ]]; then echo v1.0.0-rc.6; exit; fi
while [[ $# -gt 0 ]]; do
 if [[ $1 == --dir ]]; then target=$2; break; fi
 shift
done
cp "$TEST_ASSET/Pluto-Mac-1.0.0-rc.6-Installer.dmg" "$TEST_ASSET/SHA256SUMS.txt" "$target/"`,
    );
    stub(
      'hdiutil',
      `if [[ $1 == detach ]]; then exit; fi
while [[ $# -gt 0 ]]; do
 if [[ $1 == -mountpoint ]]; then target=$2; break; fi
 shift
done
mkdir -p "$target"
cp -R "$TEST_ASSET/Pluto.app" "$target/"`,
    );
    stub(
      'codesign',
      'if [[ $1 == -dr ]]; then if [[ -f "$3/old" ]]; then echo \'# designated => cdhash H"old"\'; else echo \'# designated => cdhash H"new"\'; fi; fi; exit "${TEST_SIGNATURE:-0}"',
    );
    stub('tccutil', 'printf "tccutil %s\\n" "$*" >> "$TEST_LOG"');
    stub('open', 'printf "open %s\\n" "$*" >> "$TEST_LOG"');
    stub('xattr', 'printf "xattr %s\\n" "$*" >> "$TEST_LOG"');
    stub(
      'mv',
      `if [[ \${TEST_SWAP_FAIL:-0} == 1 && $1 == */.pluto-install.*/Pluto.app ]]; then exit 42; fi
exec /bin/mv "$@"`,
    );
    const run = (options = {}, args = []) =>
      spawnSync('/bin/bash', [script, '--directory', applications, ...args], {
        env: {
          ...process.env,
          HOME: root,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_ASSET: asset,
          TEST_LOG: log,
          ...options,
        },
        encoding: 'utf8',
      });
    try {
      const invalidTag = run({}, ['--tag', 'v1.0.0;touch bad']);
      assert.match(invalidTag.stderr, /Invalid release tag/);
      assert.equal(existsSync(app), false);
      const profile = join(root, 'existing-profile');
      writeFileSync(profile, 'preserve meeting data');
      let result = run({ TEST_SIGNATURE: '1' });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(app), false);
      assert.equal(existsSync(log), false);
      writeFileSync(
        join(asset, 'SHA256SUMS.txt'),
        `${'0'.repeat(64)}  ${filename}\n`,
      );
      result = run();
      assert.match(result.stderr, /checksum mismatch/);
      assert.equal(existsSync(app), false);
      writeFileSync(join(asset, 'SHA256SUMS.txt'), `${digest}  ${filename}\n`);
      result = run({}, ['--verify-only']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(app), false);
      assert.equal(existsSync(log), false);
      result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(app, 'new'), 'utf8'), 'new app');
      assert.match(readFileSync(log, 'utf8'), /xattr -dr com.apple.quarantine/);
      assert.match(readFileSync(log, 'utf8'), /open .*Applications\/Pluto.app/);
      writeFileSync(join(app, 'old'), 'previous app');
      result = run({ TEST_SWAP_FAIL: '1', TEST_PUBLIC: '1' });
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(join(app, 'old'), 'utf8'), 'previous app');
      result = run({ TEST_RUNNING: '0' });
      assert.match(result.stderr, /Quit Pluto/);
      assert.equal(readFileSync(join(app, 'old'), 'utf8'), 'previous app');
      result = run({ TEST_PUBLIC: '1', TEST_LATEST_TAG: 'v1.0.0-rc.99' }, [
        '--tag',
        'v1.0.0-rc.6',
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(join(app, 'old')), false);
      assert.match(
        readFileSync(log, 'utf8'),
        /tccutil reset All com\.pluto\.app/,
      );
      assert.equal(readFileSync(profile, 'utf8'), 'preserve meeting data');
      result = run({}, ['--fresh-profile']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /separate empty profile/);
      assert.match(
        readFileSync(log, 'utf8'),
        /open -na .*--args --user-data-dir=.*pluto-first-run\./,
      );
      assert.equal(readFileSync(profile, 'utf8'), 'preserve meeting data');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
