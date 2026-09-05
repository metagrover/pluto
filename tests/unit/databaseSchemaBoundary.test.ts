import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createCalendarStore } from '../../electron/calendar/store';
import { createIdentityStore } from '../../electron/identityStore';

describe('database schema ownership boundary', () => {
  it('keeps schema DDL out of query and store modules', () => {
    for (const file of [
      'electron/db.ts',
      'electron/calendar/store.ts',
      'electron/dreaming/proposalStore.ts',
      'electron/identityStore.ts',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/\bCREATE\s+(?:VIRTUAL\s+)?TABLE\b/i);
      expect(source).not.toMatch(/\bALTER\s+TABLE\b/i);
      expect(source).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(source).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
    }
  });

  it('does not let store construction create missing schema', () => {
    const calendarSql = new Database(':memory:');
    const calendar = createCalendarStore(calendarSql);
    expect(() => calendar.getState()).toThrow();
    expect(
      calendarSql
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table'")
        .all(),
    ).toEqual([]);
    calendarSql.close();

    const identitySql = new Database(':memory:');
    const identity = createIdentityStore(identitySql);
    expect(() => identity.getRevision()).toThrow();
    expect(
      identitySql
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table'")
        .all(),
    ).toEqual([]);
    identitySql.close();
  });
});
