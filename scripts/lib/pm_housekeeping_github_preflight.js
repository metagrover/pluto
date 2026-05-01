import { spawnSync } from 'node:child_process';

const TOKEN_NAME_PATTERN = /(^|_)(GH|GITHUB|TOKEN|PAT|OAUTH|AUTH)(_|$)|GITHUB/i;

export function envTokenNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => TOKEN_NAME_PATTERN.test(name))
    .filter((name) => name === 'GH_TOKEN' || name === 'GITHUB_TOKEN')
    .sort();
}

export function classifyPreflightResult({
  envTokenNames: tokenNames,
  authExitCode,
  apiExitCode,
  issueListExitCode,
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
    message: 'GitHub preflight passed with an environment-backed token.',
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
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
