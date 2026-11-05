import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';

const planFor = (sqlite: Database.Database, query: string) =>
  (
    sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{
      detail: string;
    }>
  )
    .map((row) => row.detail)
    .join('\n');

describe('meeting list indexes', () => {
  const sqlite = new Database(':memory:');
  migrate(drizzle(sqlite), {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });

  it('orders meeting lists by the effective start index without a sort', () => {
    for (const query of [
      'SELECT id FROM meetings ORDER BY COALESCE(started_at, created_at) DESC',
      'SELECT m.id FROM meetings m ORDER BY COALESCE(m.started_at, m.created_at) DESC',
      `SELECT id FROM meetings WHERE COALESCE(started_at, created_at) >= '2026-01-01'
       ORDER BY COALESCE(started_at, created_at) DESC, id DESC`,
    ]) {
      const plan = planFor(sqlite, query);
      expect(plan).toContain('idx_meetings_effective_start');
      expect(plan).not.toContain('USE TEMP B-TREE');
    }
  });

  it('finds transcript retry candidates by status', () => {
    expect(
      planFor(
        sqlite,
        "SELECT id FROM meetings WHERE transcript_status IN ('validating', 'validated')",
      ),
    ).toContain('idx_meetings_transcript_status');
  });
});
