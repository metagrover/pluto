import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseRuntime } from '../../electron/database/runtime';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-preservation-'));
  roots.push(root);
  return root;
};
const baselineFolder = path.join(process.cwd(), 'drizzle');

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('database corruption preservation', () => {
  it('fails closed and preserves an invalid SQLite file byte-for-byte', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const original = Buffer.from('not a sqlite database: preserve me');
    fs.writeFileSync(databasePath, original);
    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder: baselineFolder,
    });

    expect(() => runtime.initialize()).toThrow();
    expect(fs.readFileSync(databasePath)).toEqual(original);
    expect(fs.readdirSync(root)).toEqual(['pluto.db']);
  });

  it('never creates a replacement database or staging directory', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'corrupted bytes');

    expect(() =>
      createDatabaseRuntime({
        databasePath,
        migrationsFolder: baselineFolder,
      }).initialize(),
    ).toThrow();
    expect(
      fs.readdirSync(root).some((name) => name.includes('replacement')),
    ).toBe(false);
  });
});
