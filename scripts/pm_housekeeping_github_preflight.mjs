#!/usr/bin/env node

import {
  buildPreflightReport,
  classifyPreflightResult,
  envTokenNames,
  parseRepoSlug,
  resolvePreflightOptions,
  runCommand,
} from './lib/pm_housekeeping_github_preflight.js';

const repo = 'metagrover/pluto';
parseRepoSlug(repo);
const tokenNames = envTokenNames();
const { runMutationCheck, mutationIssueNumber } = resolvePreflightOptions(
  process.argv.slice(2),
);

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
const permission = runCommand('gh', [
  'repo',
  'view',
  repo,
  '--json',
  'viewerPermission',
]);
const mutation = runMutationCheck
  ? runCommand('gh', [
      'issue',
      'comment',
      mutationIssueNumber,
      '--repo',
      repo,
      '--body',
      `PM housekeeping mutation preflight passed at ${new Date().toISOString()}.`,
    ])
  : { exitCode: 0 };
let permissionPayload = {};
if (permission.exitCode === 0) {
  try {
    permissionPayload = JSON.parse(permission.stdout || '{}');
  } catch {
    permissionPayload = {};
  }
}

const classification = classifyPreflightResult({
  envTokenNames: tokenNames,
  authExitCode: auth.exitCode,
  apiExitCode: api.exitCode,
  issueListExitCode: issueList.exitCode,
  permissionExitCode: permission.exitCode,
  viewerPermission: permissionPayload.viewerPermission ?? null,
  mutationExitCode: mutation.exitCode,
});

const report = buildPreflightReport({
  classification,
  tokenNames,
  auth,
  api,
  issueList,
  mutation,
});

console.log(JSON.stringify(report, null, 2));
process.exit(classification.ok ? 0 : 1);
