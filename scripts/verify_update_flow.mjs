// Packaged updater acceptance in temporary apps/profiles. Never touches /Applications or real TCC state.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  cp,
  readdir,
  lstat,
  symlink,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
assert.equal(process.platform, 'darwin');
const root = await mkdtemp(path.join(os.tmpdir(), 'pluto-update-e2e-'));
const report = [];
const command = (name, args) =>
  execFileSync(name, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const children = [];
try {
  const bin = path.join(root, 'bin');
  const asset = path.join(root, 'asset');
  await mkdir(bin);
  await mkdir(asset);
  await writeFile(path.join(bin, 'tccutil'), '#!/bin/bash\nexit 0\n', {
    mode: 0o755,
  });
  await writeFile(
    path.join(bin, 'curl'),
    `#!/bin/bash
set -eu
while [[ $# -gt 0 ]]; do
 case "$1" in -o) target=$2; shift 2 ;; https://*) url=$1; shift ;; *) shift ;; esac
done
case "$url" in
 https://api.github.com/repos/metagrover/pluto/releases*) printf '[{"tag_name":"v1.0.0-rc.2"}]' > "$target" ;;
 https://github.com/metagrover/pluto/releases/download/v1.0.0-rc.2/*)
 if [[ $url == */SHA256SUMS.txt && -n \${PLUTO_TEST_BAD_CHECKSUM:-} ]]; then printf '%064d  Pluto-Mac-1.0.0-rc.2-Installer.dmg\\n' 0 > "$target"; else cp "$PLUTO_TEST_ASSET/\${url##*/}" "$target"; fi ;;
 *) exit 91 ;;
esac
`,
    { mode: 0o755 },
  );
  const base = path.join(root, 'base', 'Pluto.app');
  await mkdir(path.dirname(base));
  command('ditto', [path.resolve(require('electron'), '../../..'), base]);
  command('/bin/mv', [
    path.join(base, 'Contents/MacOS/Electron'),
    path.join(base, 'Contents/MacOS/Pluto'),
  ]);
  // Normalize Electron's expanded npm framework links in the isolated copy.
  const frameworks = path.join(base, 'Contents/Frameworks');
  for (const name of (await readdir(frameworks)).filter((name) =>
    name.endsWith('.framework'),
  )) {
    const framework = path.join(frameworks, name);
    const versions = path.join(framework, 'Versions');
    const current = path.join(versions, 'Current');
    if ((await lstat(current)).isSymbolicLink()) continue;
    const candidates = (await readdir(versions)).filter(
      (value) => value !== 'Current',
    );
    assert.equal(candidates.length, 1);
    await rm(current, { recursive: true });
    await symlink(candidates[0], current);
    for (const member of await readdir(path.join(versions, candidates[0]))) {
      if (member === '_CodeSignature') continue;
      const target = path.join(framework, member);
      await rm(target, { recursive: true, force: true });
      await symlink(path.join('Versions/Current', member), target);
    }
  }
  const plist = path.join(base, 'Contents/Info.plist');
  for (const [key, value] of Object.entries({
    CFBundleIdentifier: 'com.pluto.app',
    CFBundleName: 'Pluto',
    CFBundleExecutable: 'Pluto',
    CFBundleShortVersionString: '1.0.0-rc.1',
    CFBundleVersion: '1.0.0-rc.1',
  }))
    command('plutil', ['-replace', key, '-string', value, plist]);
  const resources = path.join(base, 'Contents/Resources');
  await rm(path.join(resources, 'default_app.asar'), { force: true });
  await mkdir(path.join(resources, 'app'));
  await writeFile(
    path.join(resources, 'app/package.json'),
    JSON.stringify({
      name: 'pluto-update-fixture',
      version: '1.0.0-rc.1',
      main: 'main.cjs',
    }),
  );
  await build({
    entryPoints: ['scripts/lib/updateFlowHost.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: path.join(resources, 'app/main.cjs'),
  });
  await mkdir(path.join(resources, 'installer'));
  await cp(
    'scripts/install-macos.sh',
    path.join(resources, 'installer/install-macos.sh'),
  );
  command('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--entitlements',
    'build/entitlements.mac.plist',
    base,
  ]);
  const source = path.join(root, 'dmg-source');
  await mkdir(source);
  const target = path.join(source, 'Pluto.app');
  command('ditto', [base, target]);
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion'])
    command('plutil', [
      '-replace',
      key,
      '-string',
      '1.0.0-rc.2',
      path.join(target, 'Contents/Info.plist'),
    ]);
  await writeFile(
    path.join(target, 'Contents/Resources/app/package.json'),
    JSON.stringify({
      name: 'pluto-update-fixture',
      version: '1.0.0-rc.2',
      main: 'main.cjs',
    }),
  );
  command('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--entitlements',
    'build/entitlements.mac.plist',
    target,
  ]);
  const dmg = path.join(asset, 'Pluto-Mac-1.0.0-rc.2-Installer.dmg');
  command('hdiutil', [
    'create',
    '-quiet',
    '-srcfolder',
    source,
    '-volname',
    'Pluto update fixture',
    '-format',
    'UDZO',
    dmg,
  ]);
  const digest = createHash('sha256')
    .update(await readFile(dmg))
    .digest('hex');
  await writeFile(
    path.join(asset, 'SHA256SUMS.txt'),
    `${digest}  ${path.basename(dmg)}\n`,
  );
  for (const scenario of ['success', 'blocked', 'checksum', 'renderer-veto']) {
    const apps = path.join(root, scenario, 'Applications');
    const profile = path.join(root, scenario, 'profile');
    await mkdir(apps, { recursive: true });
    await mkdir(profile);
    const installed = path.join(apps, 'Pluto.app');
    command('ditto', [base, installed]);
    await writeFile(
      path.join(profile, 'fixture.json'),
      JSON.stringify({ bin, asset, scenario }),
    );
    await writeFile(
      path.join(profile, 'pluto.db'),
      'fictional-profile-must-survive',
    );
    const env = { ...process.env };
    env.ELECTRON_RUN_AS_NODE = undefined;
    const child = spawn(
      path.join(installed, 'Contents/MacOS/Pluto'),
      [`--user-data-dir=${profile}`],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(child);
    child.stdout.resume();
    child.stderr.on('data', (data) =>
      appendFileSync(path.join(profile, 'fixture-stderr.log'), data),
    );
    let events = [];
    const began = Date.now();
    while (Date.now() - began < 180000) {
      try {
        events = (await readFile(path.join(profile, 'events.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map(JSON.parse);
      } catch {}
      if (events.some((e) => e.event === 'complete')) break;
      if (child.exitCode !== null && child.exitCode !== 0)
        throw new Error(
          await readFile(path.join(profile, 'fixture-stderr.log'), 'utf8'),
        );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(
      events.some((e) => e.event === 'complete'),
      `${scenario}: no relaunch: ${JSON.stringify(events)}\n${await readFile(path.join(profile, 'logs/update.log'), 'utf8').catch(() => '')}`,
    );
    assert(
      events
        .filter((e) => e.event === 'clicks')
        .every(
          (e) => e.results.length === 2 && e.results.every((r) => r.started),
        ),
    );
    assert.equal(
      events.filter((e) => e.event === 'clicks').length,
      ['success', 'renderer-veto'].includes(scenario) ? 1 : 2,
    );
    assert.equal(
      events.filter((e) => e.event === 'launched' && e.version === '1.0.0-rc.2')
        .length,
      1,
    );
    const completed = events.find((e) => e.event === 'complete');
    assert.equal(completed.sentinel, 'fictional-profile-must-survive');
    assert.equal(completed.status.update.phase, 'complete');
    if (scenario === 'renderer-veto')
      assert(events.some((e) => e.event === 'force-exit'));
    if (scenario === 'blocked' || scenario === 'checksum') {
      assert(
        events.some((e) => e.event === 'retry' && e.version === '1.0.0-rc.1'),
      );
      assert(
        events.some(
          (e) => e.event === 'status' && e.update?.phase === 'failed',
        ),
      );
    }
    report.push({ scenario, elapsedMs: Date.now() - began, events });
    console.log(`${scenario}: passed`);
  }
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
} finally {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}
