import { spawnSync } from 'node:child_process';

const TOKEN_NAME_PATTERN = /(^|_)(GH|GITHUB|TOKEN|PAT|OAUTH|AUTH)(_|$)|GITHUB/i;
const WRITE_PERMISSIONS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

const redactTokens = (value) =>
  value
    .replace(/- Token:\s*[^\n]+/g, '- Token: [redacted]')
    .replace(/\b(?:GH_TOKEN|GITHUB_TOKEN)=([^\s]+)/g, (match) => {
      const name = match.split('=')[0];
      return `${name}=[redacted]`;
    });

export function envTokenNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => TOKEN_NAME_PATTERN.test(name))
    .filter((name) => name === 'GH_TOKEN' || name === 'GITHUB_TOKEN')
    .filter((name) => `${env[name] ?? ''}`.trim().length > 0)
    .sort();
}

export function parseRepoSlug(repo) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo);
  if (!match) {
    throw new Error('Expected --repo in owner/name format.');
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

export function hasRepoWritePermission(viewerPermission) {
  return viewerPermission ? WRITE_PERMISSIONS.has(viewerPermission) : false;
}

export function parseViewerPermission(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const viewerPermission = parsed?.data?.repository?.viewerPermission;
    return typeof viewerPermission === 'string' ? viewerPermission : null;
  } catch {
    return null;
  }
}

export function resolvePreflightOptions(argv = []) {
  let repo = 'metagrover/pluto';
  const issueNumberIndex = argv.indexOf('--issue-number');
  const mutationIssueNumber =
    issueNumberIndex >= 0 ? (argv[issueNumberIndex + 1] ?? '') : '';
  const runMutationCheck = argv.includes('--mutation-check');

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      repo = (argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length).trim();
    }
  }

  parseRepoSlug(repo);

  if (runMutationCheck && mutationIssueNumber.trim().length === 0) {
    throw new Error('--mutation-check requires --issue-number <number>.');
  }

  return {
    repo,
    runMutationCheck,
    mutationIssueNumber: mutationIssueNumber.trim(),
  };
}

export function classifyPreflightResult({
  envTokenNames: tokenNames,
  authExitCode,
  apiExitCode,
  issueListExitCode,
  permissionExitCode = 0,
  viewerPermission = null,
  mutationExitCode = 0,
}) {
  if (authExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'auth',
      message: 'GitHub CLI auth failed.',
    };
  }

  if (apiExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'network',
      message: 'GitHub API reachability failed.',
    };
  }

  if (issueListExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'issue-list',
      message: 'GitHub issue listing failed.',
    };
  }

  if (permissionExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'permission-probe',
      message: 'GitHub repository permission probe failed.',
    };
  }

  if (viewerPermission === null) {
    return {
      ok: false,
      failureKind: 'permission-probe',
      message:
        'GitHub repository permission probe returned an unreadable permission payload.',
    };
  }

  if (!hasRepoWritePermission(viewerPermission)) {
    return {
      ok: false,
      failureKind: 'write-permission',
      message:
        'GitHub auth is valid, but it does not have write-level access to the repository.',
    };
  }

  if (mutationExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'mutation',
      message: 'GitHub mutation smoke check failed.',
    };
  }

  return {
    ok: true,
    failureKind: null,
    message:
      'GitHub preflight passed with valid gh auth and write-level repository access.',
  };
}

export function buildPreflightReport({
  classification,
  tokenNames,
  repo,
  viewerPermission,
  auth,
  api,
  issueList,
  permissionProbe,
  mutation,
}) {
  const normalizeCheck = (check = {}) => ({
    command: check.command ?? '',
    exitCode: check.exitCode ?? 1,
    stdout: redactTokens(check.stdout ?? ''),
    stderr: redactTokens(check.stderr ?? ''),
    ...(check.error ? { error: redactTokens(check.error) } : {}),
  });

  return {
    ok: classification.ok,
    failureKind: classification.failureKind,
    message: classification.message,
    repo,
    tokenNames,
    viewerPermission,
    checks: {
      auth: normalizeCheck(auth),
      api: normalizeCheck(api),
      issueList: normalizeCheck(issueList),
      permissionProbe: normalizeCheck(permissionProbe),
      mutation: normalizeCheck(mutation),
    },
  };
}

export function runCommand(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    env: { ...env, GH_PROMPT_DISABLED: '1' },
    encoding: 'utf8',
  });

  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error?.message ?? '',
  };
}
