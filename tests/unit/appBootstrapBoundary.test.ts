import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('Electron bootstrap boundary', () => {
  it('locks the packaged profile before importing database-owning main code', () => {
    const source = fs.readFileSync(
      path.join(root, 'electron/bootstrap.ts'),
      'utf8',
    );

    expect(source).not.toContain("from './db'");
    expect(source).toContain("app.setPath('userData'");
    expect(source.indexOf('requestSingleInstanceLock')).toBeGreaterThan(-1);
    expect(source.indexOf("import('./main')")).toBeGreaterThan(
      source.indexOf('requestSingleInstanceLock'),
    );
  });

  it('builds Electron from the bootstrap and always isolates development data', () => {
    const source = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');

    expect(source).toContain("entry: 'electron/bootstrap.ts'");
    expect(source).toContain('resolveDevelopmentUserDataDir');
    expect(source).toContain('`--user-data-dir=${userDataDir}`');
  });
});
