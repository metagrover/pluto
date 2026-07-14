#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assembleChangelog, validateFragments } from './lib/changelog.mjs';

const usage = () => {
  process.stderr.write(
    'Usage: node scripts/changelog.mjs <check|build> [--entries <directory>] [--output <file>]\n',
  );
};

const parseArguments = (arguments_) => {
  const command = arguments_[0];
  if (command !== 'check' && command !== 'build') return null;

  const options = {
    command,
    entries: resolve('docs/changelog/entries'),
    output: null,
  };

  for (let index = 1; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || (flag !== '--entries' && flag !== '--output')) return null;
    if (flag === '--output' && command !== 'build') return null;
    options[flag.slice(2)] = resolve(value);
  }

  return options;
};

const readFragments = async (directory) => {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const markdownNames = names.filter((name) => name.endsWith('.md')).sort();
  return Promise.all(
    markdownNames.map(async (name) => ({
      path: name,
      body: await readFile(resolve(directory, name), 'utf8'),
    })),
  );
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    usage();
    process.exitCode = 1;
    return;
  }

  const fragments = await readFragments(options.entries);
  const errors = validateFragments(fragments);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.command === 'check') {
    process.stdout.write(`Validated ${fragments.length} changelog fragment(s).\n`);
    return;
  }

  const assembled = assembleChangelog(fragments);
  if (options.output) {
    await writeFile(options.output, assembled);
    process.stdout.write(`Wrote ${fragments.length} changelog fragment(s) to ${options.output}.\n`);
  } else {
    process.stdout.write(assembled);
  }
};

await main();
