import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from '../../scripts/lib/privateEvaluationFile';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('writeOwnerOnlyPrivateFile', () => {
  it('tightens an existing file to owner-only permissions', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-private-evaluation-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'review.html');
    fs.writeFileSync(filePath, 'old', { mode: 0o644 });

    writeOwnerOnlyPrivateFile(filePath, 'new');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('new');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('refuses a symlink without changing its target', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-private-evaluation-'),
    );
    temporaryDirectories.push(directory);
    const targetPath = path.join(directory, 'keep.txt');
    const filePath = path.join(directory, 'review.html');
    fs.writeFileSync(targetPath, 'keep');
    fs.symlinkSync(targetPath, filePath);

    expect(() => writeOwnerOnlyPrivateFile(filePath, 'replace')).toThrow(
      'private_evaluation_path_unsafe',
    );
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('keep');
  });
});

describe('appendOwnerOnlyPrivateLine', () => {
  it('flushes append-only JSONL with owner-only permissions', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-private-evaluation-ledger-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'events.jsonl');
    appendOwnerOnlyPrivateLine(filePath, { type: 'run_started', runId: 'one' });
    appendOwnerOnlyPrivateLine(filePath, {
      type: 'logical_terminal',
      runId: 'one',
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      '{"type":"run_started","runId":"one"}\n' +
        '{"type":"logical_terminal","runId":"one"}\n',
    );
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
