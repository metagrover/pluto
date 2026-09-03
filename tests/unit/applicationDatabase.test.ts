import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApplicationDatabase,
  resolveApplicationDatabasePath,
  resolveMigrationsFolder,
} from '../../electron/database/applicationDatabase';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('application database ownership', () => {
  it('resolves development and packaged paths explicitly', () => {
    expect(resolveApplicationDatabasePath({ userDataPath: '/profile' })).toBe(
      '/profile/pluto.db',
    );
    expect(
      resolveMigrationsFolder({
        isPackaged: false,
        appRoot: '/checkout',
        resourcesPath: '/resources',
      }),
    ).toBe('/checkout/drizzle');
    expect(
      resolveMigrationsFolder({
        isPackaged: true,
        appRoot: '/checkout',
        resourcesPath: '/Resources',
      }),
    ).toBe('/Resources/drizzle');
  });

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

  it('repairs missing derived search rows when reopening a managed database', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-application-db-'),
    );
    roots.push(root);
    const options = {
      databasePath: path.join(root, 'pluto.db'),
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    };
    const first = createApplicationDatabase(options);
    first
      .initialize()
      .prepare(
        "INSERT INTO meetings (id, title) VALUES ('missing-fts', 'Search me')",
      )
      .run();
    first.close();

    const reopened = createApplicationDatabase(options);
    const sqlite = reopened.initialize();
    expect(
      sqlite
        .prepare(
          "SELECT meeting_id FROM meetings_fts WHERE meeting_id = 'missing-fts'",
        )
        .all(),
    ).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "SELECT meeting_id FROM meeting_notes_fts WHERE meeting_id = 'missing-fts'",
        )
        .all(),
    ).toHaveLength(1);
    reopened.close();
  });

  it('closes the runtime when first-run operational recovery fails', () => {
    const close = vi.fn();
    const owner = createApplicationDatabase({
      databasePath: ':memory:',
      migrationsFolder: '/unused',
      createRuntime: () => ({
        state: 'open',
        initialize: () =>
          ({
            transaction: () => () => {
              throw new Error('recovery failed');
            },
          }) as never,
        getConnection: () => {
          throw new Error('unused');
        },
        close,
      }),
    });
    expect(() => owner.initialize()).toThrow('recovery failed');
    expect(close).toHaveBeenCalledOnce();
  });
});
