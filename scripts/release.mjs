#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Accept the old dotted RC tags too; all new tags use SemVer.
export const normalizeVersion = (value) =>
  value.replace(/^v/, '').replace('.rc.', '-rc.');

export function nextVersion(current, kind = 'auto') {
  const match = normalizeVersion(current).match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/,
  );
  if (!match) throw new Error(`Unsupported release version: ${current}`);
  const [, major, minor, patch, rc] = match;
  const base = `${major}.${minor}.${patch}`;
  const bump = kind === 'auto' ? (rc === undefined ? 'patch' : 'rc') : kind;
  if (bump === 'rc')
    return rc === undefined
      ? `${major}.${minor}.${Number(patch) + 1}-rc.1`
      : `${base}-rc.${Number(rc) + 1}`;
  if (bump === 'stable') {
    if (rc === undefined)
      throw new Error('Already stable. Choose patch, minor, or major.');
    return base;
  }
  if (bump === 'patch') return `${major}.${minor}.${Number(patch) + 1}`;
  if (bump === 'minor') return `${major}.${Number(minor) + 1}.0`;
  if (bump === 'major') return `${Number(major) + 1}.0.0`;
  throw new Error(`Unknown release kind: ${kind}`);
}

export function releaseNotes(version, previousTag, commits, repository) {
  const url = `https://github.com/${repository}`;
  const changes = commits.length
    ? commits
        .map(
          ({ hash, subject }) =>
            `- ${subject.replace(/[\[\]<>]/g, '')} ([${hash.slice(0, 7)}](${url}/commit/${hash}))`,
        )
        .join('\n')
    : `- Promotes [${previousTag}](${url}/releases/tag/${previousTag}) to stable with no additional code changes.`;
  return `# Pluto ${version}\n\n${version.includes('-rc.') ? 'Release candidate for testing.\n\n' : ''}## Changes\n\n${changes}\n\n## Installation\n\nDownload the Apple Silicon macOS installer attached to this release and drag Pluto.app into Applications. SHA256SUMS.txt contains its checksum. If you trust this release, open it with one Terminal command:\n\n\`\`\`sh\nxattr -dr com.apple.quarantine "/Applications/Pluto.app" && open "/Applications/Pluto.app"\n\`\`\`\n\nThis removes only Pluto\'s quarantine attribute, leaving system-wide Gatekeeper protection, permissions, and user data unchanged. The current build is ad-hoc signed and is not notarized. Existing profiles are preserved; keep a backup before upgrading.\n${previousTag ? `\n[Full comparison](${url}/compare/${previousTag}...v${version})\n` : ''}`;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(
      'pnpm release [auto|rc|stable|patch|minor|major] [--dry-run] [--notes FILE]',
    );
    return;
  }
  let kind = 'auto';
  let dryRun = false;
  let notesFile;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--notes' && args[i + 1]) notesFile = args[++i];
    else if (
      ['auto', 'rc', 'stable', 'patch', 'minor', 'major'].includes(arg) &&
      i === 0
    )
      kind = arg;
    else throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  const capture = (command, arguments_) =>
    execFileSync(command, arguments_, { encoding: 'utf8' }).trim();
  const run = (command, arguments_) =>
    execFileSync(command, arguments_, { stdio: 'inherit' });
  const git = (...arguments_) => capture('git', arguments_);
  if (git('status', '--porcelain'))
    throw new Error(
      'Release requires a clean checkout. Commit or stash your work first.',
    );
  run('gh', ['auth', 'status']);
  const repository = JSON.parse(
    capture('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']),
  );
  const branch = repository.defaultBranchRef.name;
  if (git('branch', '--show-current') !== branch)
    throw new Error(`Release from ${branch} after merging your changes.`);
  run('git', ['fetch', 'origin', '--tags']);
  if (git('rev-parse', 'HEAD') !== git('rev-parse', `origin/${branch}`))
    throw new Error(
      `Local ${branch} must match origin/${branch}. Pull or push first.`,
    );
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = nextVersion(pkg.version, kind);
  const tag = `v${version}`;
  const tags = git('tag', '--list').split('\n').filter(Boolean);
  if (tags.some((existing) => normalizeVersion(existing) === version))
    throw new Error(`${tag} already exists.`);
  // Closest release on this branch is the notes boundary; ignore unrelated tags.
  const previousTag = git('log', '--first-parent', '--format=%D')
    .split('\n')
    .flatMap((line) =>
      [
        ...line.matchAll(
          /tag: (v\d+\.\d+\.\d+(?:-rc\.\d+|\.rc\.\d+)?)(?=,|$)/g,
        ),
      ].map((match) => match[1]),
    )[0];
  const records = git(
    'log',
    '--no-merges',
    '--format=%H%x09%s',
    previousTag ? `${previousTag}..HEAD` : 'HEAD',
  );
  const commits = records
    ? records.split('\n').map((line) => {
        const [hash, ...subject] = line.split('\t');
        return { hash, subject: subject.join(' ') };
      })
    : [];
  if (!commits.length && kind !== 'stable')
    throw new Error('No changes since the previous release.');
  const notes = notesFile
    ? `${readFileSync(resolve(notesFile), 'utf8').trim()}\n`
    : releaseNotes(version, previousTag, commits, repository.nameWithOwner);
  if (!notes.trim()) throw new Error('Release notes must not be empty.');
  const notesPath = `docs/releases/${tag}.md`;
  console.log(
    `${pkg.version} → ${version}\nTag: ${tag}\nNotes: ${notesPath}\n\n${notes}`,
  );
  if (dryRun) return;
  // Check before any edits/tags: the CLI must be able to watch publication.
  let workflowState;
  try {
    workflowState = capture('gh', [
      'api',
      `repos/${repository.nameWithOwner}/actions/workflows/release.yml`,
      '--jq',
      '.state',
    ]);
  } catch {
    throw new Error(
      'GitHub token needs Actions read access and repository Contents write access. Update gh authentication before releasing. No release files or tags were changed.',
    );
  }
  if (workflowState !== 'active')
    throw new Error('Enable the GitHub Release workflow before releasing.');
  run('pnpm', ['run', 'changelog:check']);
  // CI runs tests and builds before publishing; release metadata is the only local edit.
  pkg.version = version;
  mkdirSync('docs/releases', { recursive: true });
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(notesPath, notes);
  run('git', ['add', 'package.json', notesPath]);
  run('git', ['commit', '-m', `Release ${tag}`]);
  if (git('status', '--porcelain'))
    throw new Error('Commit hooks left changes. Review them before tagging.');
  run('git', ['tag', '-a', tag, '-m', `Pluto ${version}`]);
  const commit = git('rev-parse', 'HEAD');
  console.log(
    `If pushing fails, retry: git push --atomic origin ${branch} ${tag}`,
  );
  run('git', ['push', '--atomic', 'origin', branch, tag]);
  console.log('Waiting for GitHub to build, verify, and publish the release…');
  let workflow;
  for (let attempt = 0; attempt < 24; attempt++) {
    const runs = JSON.parse(
      capture('gh', [
        'run',
        'list',
        '--workflow',
        'release.yml',
        '--commit',
        commit,
        '--event',
        'push',
        '--json',
        'databaseId,headBranch',
        '--limit',
        '20',
      ]),
    );
    workflow = runs.find((candidate) => candidate.headBranch === tag);
    if (workflow) break;
    await setTimeout(5000);
  }
  if (!workflow)
    throw new Error(
      'Tag pushed but workflow was not found. Check: gh run list --workflow release.yml. Do not bump again.',
    );
  console.log(`Recovery: gh run rerun ${workflow.databaseId} --failed`);
  run('gh', ['run', 'watch', String(workflow.databaseId), '--exit-status']);
  console.log(
    capture('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url']),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
