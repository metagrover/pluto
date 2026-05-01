#!/usr/bin/env node

import {
  classifyPreflightResult,
  envTokenNames,
  runCommand,
} from './lib/pm_housekeeping_github_preflight.js';

const repo = 'metagrover/pluto';
const tokenNames = envTokenNames();
const args = new Set(process.argv.slice(2));
const runMutationCheck = args.has('--mutation-check');

const auth = runCommand('gh', ['auth', 'status', '--hostname', 'github.com']);
const api = runCommand('curl', [
  '-fsSIL',
  '--connect-timeout',
  '10',
  '--max-time',
  '20',
  'https://api.github.com',
]);
const issueList = runCommand('gh', [
  'issue',
  'list',
  '--repo',
  repo,
  '--limit',
  '1',
]);
const mutation = runMutationCheck
  ? runCommand('gh', [
      'issue',
      'comment',
      '67',
      '--repo',
      repo,
      '--body',
      `PM housekeeping mutation preflight passed at ${new Date().toISOString()}.`,
    ])
  : { exitCode: 0 };

const classification = classifyPreflightResult({
  envTokenNames: tokenNames,
  authExitCode: auth.exitCode,
  apiExitCode: api.exitCode,
  issueListExitCode: issueList.exitCode,
  mutationExitCode: mutation.exitCode,
});

const report = {
  ok: classification.ok,
  failureKind: classification.failureKind,
  message: classification.message,
  tokenNames,
  checks: {
    auth: auth.exitCode,
    api: api.exitCode,
    issueList: issueList.exitCode,
    mutation: mutation.exitCode,
  },
};

console.log(JSON.stringify(report, null, 2));
process.exit(classification.ok ? 0 : 1);
