import { describe, expect, it } from 'vitest';

import {
  buildPreflightReport,
  classifyPreflightResult,
  envTokenNames,
  resolvePreflightOptions,
} from '../../scripts/lib/pm_housekeeping_github_preflight.js';

describe('PM housekeeping GitHub preflight helpers', () => {
  it('redacts environment token inventory down to variable names', () => {
    expect(
      envTokenNames({
        GH_TOKEN: 'secret',
        GITHUB_TOKEN: 'secret',
        npm_config_user_agent: 'pnpm',
        SSH_AUTH_SOCK: '/tmp/socket',
      }),
    ).toEqual(['GH_TOKEN', 'GITHUB_TOKEN']);
  });

  it('ignores empty GitHub token values', () => {
    expect(
      envTokenNames({
        GH_TOKEN: '',
        GITHUB_TOKEN: '   ',
      }),
    ).toEqual([]);
  });

  it('classifies missing token environment separately from keyring auth', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: [],
        authExitCode: 0,
        apiExitCode: 0,
        issueListExitCode: 0,
      }),
    ).toEqual({
      ok: false,
      failureKind: 'missing-env-token',
      message:
        'GitHub CLI works, but GH_TOKEN/GITHUB_TOKEN is not present for the automation runtime.',
    });
  });

  it('classifies API reachability failures distinctly from auth failures', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: ['GH_TOKEN'],
        authExitCode: 0,
        apiExitCode: 6,
        issueListExitCode: 0,
      }),
    ).toMatchObject({
      ok: false,
      failureKind: 'network',
    });
  });

  it('passes when token-backed auth, API reachability, and issue listing pass', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: ['GITHUB_TOKEN'],
        authExitCode: 0,
        apiExitCode: 0,
        issueListExitCode: 0,
      }),
    ).toEqual({
      ok: true,
      failureKind: null,
      message: 'GitHub preflight passed with an environment-backed token.',
    });
  });

  it('requires an explicit issue number for mutation checks', () => {
    expect(() => resolvePreflightOptions(['--mutation-check'])).toThrow(
      '--mutation-check requires --issue-number <number>.',
    );
  });

  it('uses the caller-provided issue number for mutation checks', () => {
    expect(
      resolvePreflightOptions(['--mutation-check', '--issue-number', '123']),
    ).toEqual({
      runMutationCheck: true,
      mutationIssueNumber: '123',
    });
  });

  it('includes command-level diagnostics in the preflight report', () => {
    expect(
      buildPreflightReport({
        classification: {
          ok: false,
          failureKind: 'network',
          message: 'GitHub API reachability failed.',
        },
        tokenNames: ['GH_TOKEN'],
        auth: {
          command: 'gh auth status --hostname github.com',
          exitCode: 0,
          stdout: 'Logged in to github.com',
          stderr: '',
        },
        api: {
          command: 'curl -fsSIL https://api.github.com',
          exitCode: 6,
          stdout: '',
          stderr: 'Could not resolve host: api.github.com',
        },
        issueList: {
          command: 'gh issue list --repo metagrover/pluto --limit 1',
          exitCode: 1,
          stdout: '',
          stderr: 'error connecting to api.github.com',
        },
        mutation: {
          command: 'gh issue comment 67 --repo metagrover/pluto --body test',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      }),
    ).toEqual({
      ok: false,
      failureKind: 'network',
      message: 'GitHub API reachability failed.',
      tokenNames: ['GH_TOKEN'],
      checks: {
        auth: {
          command: 'gh auth status --hostname github.com',
          exitCode: 0,
          stdout: 'Logged in to github.com',
          stderr: '',
        },
        api: {
          command: 'curl -fsSIL https://api.github.com',
          exitCode: 6,
          stdout: '',
          stderr: 'Could not resolve host: api.github.com',
        },
        issueList: {
          command: 'gh issue list --repo metagrover/pluto --limit 1',
          exitCode: 1,
          stdout: '',
          stderr: 'error connecting to api.github.com',
        },
        mutation: {
          command: 'gh issue comment 67 --repo metagrover/pluto --body test',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      },
    });
  });

  it('captures spawn failures in command diagnostics', () => {
    expect(
      buildPreflightReport({
        classification: {
          ok: false,
          failureKind: 'auth',
          message: 'GitHub CLI auth failed with the environment-backed token.',
        },
        tokenNames: ['GITHUB_TOKEN'],
        auth: {
          command: 'gh auth status --hostname github.com',
          exitCode: 1,
          stdout: '',
          stderr: '',
          error: 'spawnSync gh ENOENT',
        },
        api: {
          command: 'curl -fsSIL https://api.github.com',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        issueList: {
          command: 'gh issue list --repo metagrover/pluto --limit 1',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        mutation: {
          command: '',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      }).checks.auth,
    ).toEqual({
      command: 'gh auth status --hostname github.com',
      exitCode: 1,
      stdout: '',
      stderr: '',
      error: 'spawnSync gh ENOENT',
    });
  });

  it('preserves a stable mutation check shape when mutation checks are disabled', () => {
    expect(
      buildPreflightReport({
        classification: {
          ok: true,
          failureKind: null,
          message: 'GitHub preflight passed with an environment-backed token.',
        },
        tokenNames: ['GH_TOKEN'],
        auth: {
          command: 'gh auth status --hostname github.com',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        api: {
          command: 'curl -fsSIL https://api.github.com',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        issueList: {
          command: 'gh issue list --repo metagrover/pluto --limit 1',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        mutation: {
          exitCode: 0,
        },
      }).checks.mutation,
    ).toEqual({
      command: '',
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });
});
