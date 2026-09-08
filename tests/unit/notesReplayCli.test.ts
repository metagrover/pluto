import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const roots: string[] = [];
const rootFor = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-replay-cli-test-'));
  roots.push(root);
  fs.chmodSync(root, 0o700);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const run = (script: string, args: string[]) =>
  execFileSync(
    process.execPath,
    [require.resolve('tsx/cli'), `scripts/${script}.ts`, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 },
  );
describe('notes replay CLI safety and crash reporting', () => {
  it('requires isolation opt-in and a private source before daemon access', () => {
    expect(() =>
      run('run_notes_cache_isolation', ['/nonexistent/source.json']),
    ).toThrow();
    const root = rootFor();
    const source = path.join(root, 'public-source.json');
    fs.writeFileSync(source, '{}', { mode: 0o644 });
    expect(() => run('run_notes_cache_isolation', [source, '--run'])).toThrow();
    expect(fs.readdirSync(root)).toEqual(['public-source.json']);
  });
  it('does not write diagnostics into an unrelated private directory', () => {
    const root = rootFor();
    expect(() => run('replay_notes_response_case', [root, '3'])).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('summarizes an interrupted ledger without contacting a provider or dropping rows', () => {
    const root = rootFor();
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        schema: 'notes-production-replay-v1',
        scheduled: [
          { index: 1, sourceIdSha256: 'a' },
          { index: 2, sourceIdSha256: 'b' },
        ],
      }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(root, 'events.jsonl'),
      `${JSON.stringify({ event: 'meeting_started', index: 1, sourceIdSha256: 'a' })}\n${JSON.stringify({ event: 'physical_started', caseIndex: 1, attempt: 1 })}\n{"partial":`,
      { mode: 0o600 },
    );
    const summary = JSON.parse(run('summarize_notes_replay', [root]));
    expect(summary).toMatchObject({
      scheduled: 2,
      censoredRequests: 1,
      incompleteLedgerTail: true,
      counts: { no_terminal_record: 1, not_started: 1 },
    });
    expect(fs.statSync(path.join(root, 'summary.json')).mode & 0o777).toBe(
      0o600,
    );
  });
  it('refuses offline replay writes into a non-private directory', () => {
    const root = rootFor();
    fs.chmodSync(root, 0o755);
    expect(() => run('replay_notes_response_case', [root, '3'])).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('requires explicit run opt-in before reading a production source', () => {
    expect(() =>
      run('run_notes_replay', ['/nonexistent/source.json']),
    ).toThrow();
  });
  it('refuses a symlink source export before model access', () => {
    const root = rootFor();
    fs.writeFileSync(path.join(root, 'source.json'), '{}', { mode: 0o600 });
    fs.symlinkSync(
      path.join(root, 'source.json'),
      path.join(root, 'alias.json'),
    );
    expect(() =>
      run('run_notes_replay', [path.join(root, 'alias.json'), '--run']),
    ).toThrow();
  });
});
