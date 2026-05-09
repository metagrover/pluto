import { describe, expect, it } from 'vitest';

import {
  buildPreflightReport,
  classifyPreflightResult,
  envTokenNames,
  hasRepoWritePermission,
  parseRepoSlug,
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

  it('parses valid owner/name repository slugs', () => {
    expect(parseRepoSlug('metagrover/pluto')).toEqual({
      owner: 'metagrover',
      name: 'pluto',
    });
  });

  it('rejects malformed repository slugs', () => {
    expect(() => parseRepoSlug('metagrover')).toThrow(
      'Expected --repo in owner/name format.',
    );
  });

  it('treats maintain, write, and admin as write-level repository access', () => {
    expect(hasRepoWritePermission('ADMIN')).toBe(true);
    expect(hasRepoWritePermission('MAINTAIN')).toBe(true);
    expect(hasRepoWritePermission('WRITE')).toBe(true);
    expect(hasRepoWritePermission('TRIAGE')).toBe(false);
    expect(hasRepoWritePermission('READ')).toBe(false);
    expect(hasRepoWritePermission(null)).toBe(false);
  });

  it('accepts keyring-backed gh auth when repo checks pass', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: [],
        authExitCode: 0,
        apiExitCode: 0,
        issueListExitCode: 0,
        permissionExitCode: 0,
        viewerPermission: 'ADMIN',
      }),
    ).toEqual({
      ok: true,
      failureKind: null,
      message:
        'GitHub preflight passed with valid gh auth and write-level repository access.',
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

  it('passes when env-token-backed auth, API reachability, and issue listing pass', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: ['GITHUB_TOKEN'],
        authExitCode: 0,
        apiExitCode: 0,
        issueListExitCode: 0,
        permissionExitCode: 0,
        viewerPermission: 'WRITE',
      }),
    ).toEqual({
      ok: true,
      failureKind: null,
      message:
        'GitHub preflight passed with valid gh auth and write-level repository access.',
    });
  });

  it('classifies insufficient repository scope separately from other failures', () => {
    expect(
      classifyPreflightResult({
        envTokenNames: ['GH_TOKEN'],
        authExitCode: 0,
        apiExitCode: 0,
        issueListExitCode: 0,
        permissionExitCode: 0,
        viewerPermission: 'READ',
      }),
    ).toEqual({
      ok: false,
      failureKind: 'write-permission',
      message:
        'GitHub auth is valid, but it does not have write-level access to the repository.',
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
      repo: 'metagrover/pluto',
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
        repo: 'metagrover/pluto',
        tokenNames: ['GH_TOKEN'],
        viewerPermission: 'WRITE',
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
        permissionProbe: {
          command: 'gh api graphql -f owner=metagrover -f name=pluto ...',
          exitCode: 0,
          stdout: '{"data":{"repository":{"viewerPermission":"WRITE"}}}',
          stderr: '',
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
      repo: 'metagrover/pluto',
      tokenNames: ['GH_TOKEN'],
      viewerPermission: 'WRITE',
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
        permissionProbe: {
          command: 'gh api graphql -f owner=metagrover -f name=pluto ...',
          exitCode: 0,
          stdout: '{"data":{"repository":{"viewerPermission":"WRITE"}}}',
          stderr: '',
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
          message: 'GitHub CLI auth failed.',
        },
        repo: 'metagrover/pluto',
        tokenNames: ['GITHUB_TOKEN'],
        viewerPermission: null,
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
        permissionProbe: {
          command: '',
          exitCode: 1,
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

  it('redacts token lines from command diagnostics', () => {
    expect(
      buildPreflightReport({
        classification: {
          ok: false,
          failureKind: 'auth',
          message: 'GitHub CLI auth failed.',
        },
        repo: 'metagrover/pluto',
        tokenNames: ['GH_TOKEN'],
        viewerPermission: null,
        auth: {
          command: 'gh auth status --hostname github.com',
          exitCode: 1,
          stdout:
            "github.com\n  ✓ Logged in to github.com account metagrover (keyring)\n  - Token: gho_************************************\n  - Token scopes: 'repo'",
          stderr:
            'error: GH_TOKEN=gho_************************************ was rejected',
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
        permissionProbe: {
          command: '',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        mutation: {
          exitCode: 0,
        },
      }).checks.auth,
    ).toEqual({
      command: 'gh auth status --hostname github.com',
      exitCode: 1,
      stdout:
        "github.com\n  ✓ Logged in to github.com account metagrover (keyring)\n  - Token: [redacted]\n  - Token scopes: 'repo'",
      stderr: 'error: GH_TOKEN=[redacted] was rejected',
    });
  });

  it('preserves a stable mutation check shape when mutation checks are disabled', () => {
    expect(
      buildPreflightReport({
        classification: {
          ok: true,
          failureKind: null,
          message:
            'GitHub preflight passed with valid gh auth and write-level repository access.',
        },
        repo: 'metagrover/pluto',
        tokenNames: ['GH_TOKEN'],
        viewerPermission: 'WRITE',
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
        permissionProbe: {
          command: 'gh api graphql -f owner=metagrover -f name=pluto ...',
          exitCode: 0,
          stdout: '{"data":{"repository":{"viewerPermission":"WRITE"}}}',
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
