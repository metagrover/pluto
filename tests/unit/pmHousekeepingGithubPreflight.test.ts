import { describe, expect, it } from 'vitest';

import {
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
});
