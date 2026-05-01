import { spawnSync } from 'node:child_process';

const TOKEN_NAME_PATTERN = /(^|_)(GH|GITHUB|TOKEN|PAT|OAUTH|AUTH)(_|$)|GITHUB/i;
const TOKEN_VALUE_PATTERN = /\bgh[opusr]_[A-Za-z0-9_*]+\b/gi;
const TOKEN_ASSIGNMENT_PATTERN = /\b(GH_TOKEN|GITHUB_TOKEN)=\S+/g;
const TOKEN_STATUS_LINE_PATTERN = /^(\s*-\s*Token:\s*).+$/gm;

export function envTokenNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => TOKEN_NAME_PATTERN.test(name))
    .filter((name) => name === 'GH_TOKEN' || name === 'GITHUB_TOKEN')
    .filter((name) => `${env[name] ?? ''}`.trim().length > 0)
    .sort();
}

export function parseRepoSlug(repoSlug) {
  const [owner, name, ...rest] = `${repoSlug ?? ''}`
    .trim()
    .split('/')
    .filter(Boolean);

  if (!owner || !name || rest.length > 0) {
    throw new Error('Expected --repo in owner/name format.');
  }

  return { owner, name };
}

export function hasRepoWritePermission(viewerPermission) {
  if (typeof viewerPermission !== 'string') return false;
  return ['ADMIN', 'MAINTAIN', 'WRITE'].includes(
    viewerPermission.trim().toUpperCase(),
  );
}

export function resolvePreflightOptions(argv = []) {
  const args = new Set(argv);
  const issueNumberIndex = argv.indexOf('--issue-number');
  const mutationIssueNumber =
    issueNumberIndex >= 0 ? (argv[issueNumberIndex + 1] ?? '') : '';
  const runMutationCheck = args.has('--mutation-check');

  if (runMutationCheck && mutationIssueNumber.trim().length === 0) {
    throw new Error('--mutation-check requires --issue-number <number>.');
  }

  return {
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
  if (tokenNames.length === 0) {
    return {
      ok: false,
      failureKind: 'missing-env-token',
      message:
        'GitHub CLI works, but GH_TOKEN/GITHUB_TOKEN is not present for the automation runtime.',
    };
  }

  if (authExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'auth',
      message: 'GitHub CLI auth failed with the environment-backed token.',
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
      failureKind: 'permission-check',
      message: 'GitHub repository permission check failed.',
    };
  }

  if (!hasRepoWritePermission(viewerPermission)) {
    return {
      ok: false,
      failureKind: 'write-permission',
      message:
        'GitHub token is valid, but it does not have write-level access to the repository.',
    };
  }

  if (mutationExitCode !== 0) {
    return {
      ok: false,
      failureKind: 'mutation',
      message: 'GitHub dry-run-safe mutation failed.',
    };
  }

  return {
    ok: true,
    failureKind: null,
    message:
      'GitHub preflight passed with an environment-backed token and write-level repository access.',
  };
}

function sanitizeOutput(value) {
  return `${value ?? ''}`
    .replace(TOKEN_STATUS_LINE_PATTERN, '$1[redacted]')
    .replace(TOKEN_ASSIGNMENT_PATTERN, '$1=[redacted]')
    .replace(TOKEN_VALUE_PATTERN, '[redacted]');
}

export function buildPreflightReport({
  classification,
  tokenNames,
  auth,
  api,
  issueList,
  mutation,
}) {
  const normalizeCheck = (check) => ({
    command: check.command ?? '',
    exitCode: check.exitCode ?? 1,
    stdout: sanitizeOutput(check.stdout),
    stderr: sanitizeOutput(check.stderr),
    ...(check.error ? { error: check.error } : {}),
  });

  return {
    ok: classification.ok,
    failureKind: classification.failureKind,
    message: classification.message,
    tokenNames,
    checks: {
      auth: normalizeCheck(auth),
      api: normalizeCheck(api),
      issueList: normalizeCheck(issueList),
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
