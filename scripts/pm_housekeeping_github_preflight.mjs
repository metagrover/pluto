#!/usr/bin/env node

import {
  buildPreflightReport,
  classifyPreflightResult,
  envTokenNames,
  parseRepoSlug,
  parseViewerPermission,
  resolvePreflightOptions,
  runCommand,
} from './lib/pm_housekeeping_github_preflight.js';

const tokenNames = envTokenNames();
const { repo, runMutationCheck, mutationIssueNumber } = resolvePreflightOptions(
  process.argv.slice(2),
);
const { owner, name } = parseRepoSlug(repo);

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
const permissionProbe = runCommand('gh', [
  'api',
  'graphql',
  '-f',
  `owner=${owner}`,
  '-f',
  `name=${name}`,
  '-f',
  'query=query($owner:String!, $name:String!) { repository(owner: $owner, name: $name) { viewerPermission } }',
]);
const viewerPermission =
  permissionProbe.exitCode === 0
    ? parseViewerPermission(permissionProbe.stdout)
    : null;
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

const classification = classifyPreflightResult({
  envTokenNames: tokenNames,
  authExitCode: auth.exitCode,
  apiExitCode: api.exitCode,
  issueListExitCode: issueList.exitCode,
  permissionExitCode: permissionProbe.exitCode,
  viewerPermission,
  mutationExitCode: mutation.exitCode,
});

const report = buildPreflightReport({
  classification,
  tokenNames,
  repo,
  viewerPermission,
  auth,
  api,
  issueList,
  permissionProbe,
  mutation,
});

console.log(JSON.stringify(report, null, 2));
process.exit(classification.ok ? 0 : 1);
