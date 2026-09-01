import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplicationDatabase } from '../../electron/database/applicationDatabase';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('application database ownership', () => {
  it('reuses one connection, performs operational recovery, and closes once', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-application-db-'),
    );
    roots.push(root);
    const owner = createApplicationDatabase({
      databasePath: path.join(root, 'pluto.db'),
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });
    const first = owner.initialize();
    first
      .prepare("INSERT INTO meetings (id, title) VALUES ('m1', 'Meeting')")
      .run();
    first
      .prepare(
        `INSERT INTO identity_jobs
         (meeting_id, revision, fingerprint, state)
         VALUES ('m1', 1, 'fingerprint', 'running')`,
      )
      .run();

    expect(owner.getConnection()).toBe(first);
    expect(owner.runStartupRecovery()).toMatchObject({
      identityJobsRecovered: 1,
    });
    expect(
      first
        .prepare("SELECT state FROM identity_jobs WHERE meeting_id = 'm1'")
        .get(),
    ).toEqual({
      state: 'pending',
    });
    owner.close();
    owner.close();
    expect(() => owner.getConnection()).toThrowError(
      expect.objectContaining({ code: 'database_closed' }),
    );
  });
});
