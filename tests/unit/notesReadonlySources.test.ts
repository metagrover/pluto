import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readReadonlyMeetingSources } from '../../scripts/lib/notes_readonly_sources.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const fixture = () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'notes-readonly-unit-')),
  );
  roots.push(root);
  const database = path.join(root, 'source.db');
  fs.writeFileSync(database, 'unchanged source');
  return database;
};
describe('read-only notes sources', () => {
  it('orders real SQLite rows by date before limiting, including pending rows', () => {
    const database = fixture();
    fs.unlinkSync(database);
    execFileSync('/usr/bin/sqlite3', [
      database,
      `
      CREATE TABLE meetings (id TEXT, started_at TEXT, created_at TEXT, transcript_json TEXT, transcript_status TEXT, finalization_status TEXT, transcript_integrity_json TEXT, duration_seconds INTEGER);
      WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 11)
      INSERT INTO meetings SELECT printf('%02d', 12-value), printf('2026-09-%02d', value), NULL, NULL, 'validating', 'processing', NULL, 0 FROM n;
    `,
    ]);
    const before = fs.readFileSync(database);
    const result = readReadonlyMeetingSources(database, undefined, {
      latestTen: true,
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
    ]);
    expect(fs.readFileSync(database)).toEqual(before);
    expect(fs.readdirSync(path.dirname(database))).toEqual(['source.db']);
    const cli = JSON.parse(
      execFileSync(
        process.execPath,
        ['scripts/read_notes_sources.mjs', database],
        {
          encoding: 'utf8',
        },
      ),
    );
    roots.push(cli.privateOutput);
    expect(cli.selectedMeetings).toBe(10);
    expect(cli.eligibleMeetings).toBeUndefined();
    expect(fs.statSync(cli.privateOutput).mode & 0o777).toBe(0o700);
    const exported = path.join(cli.privateOutput, 'sources.json');
    expect(fs.statSync(exported).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(exported, 'utf8')).rows).toEqual(
      result.rows,
    );
    expect(fs.readFileSync(database)).toEqual(before);
  });
  it('selects the latest ten without replacing ineligible meetings', () => {
    const query = vi.fn(() =>
      JSON.stringify([
        {
          id: 'pending',
          transcript_json: null,
          finalization_status: 'processing',
        },
      ]),
    );
    const result = readReadonlyMeetingSources(fixture(), query, {
      latestTen: true,
    });
    expect(result.rows).toHaveLength(1);
    expect(query.mock.calls[0][1]).toContain(
      'ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 10',
    );
    expect(query.mock.calls[0][1]).not.toContain('WHERE transcript_status');
  });
  it('does not expose private subprocess output on failure', () => {
    const database = fixture();
    expect(() =>
      readReadonlyMeetingSources(database, () => {
        throw new Error('private transcript bytes');
      }),
    ).toThrow('readonly_source_query_failed');
    expect(() =>
      readReadonlyMeetingSources(database, () => 'private transcript bytes'),
    ).toThrow('source_query_invalid');
  });
  it('uses immutable read-only SQL with a source-only projection', () => {
    const database = fixture();
    const query = vi.fn(() => '[]');
    expect(readReadonlyMeetingSources(database, query).rows).toEqual([]);
    expect(query.mock.calls[0][0]).toContain('?mode=ro&immutable=1');
    expect(query.mock.calls[0][1]).toContain('PRAGMA query_only=ON;');
    expect(query.mock.calls[0][1]).not.toMatch(
      /analysis_json|user_notes|settings|INSERT|UPDATE|DELETE|checkpoint/i,
    );
    expect(fs.readFileSync(database, 'utf8')).toBe('unchanged source');
    expect(fs.readdirSync(path.dirname(database))).toEqual(['source.db']);
  });
  it.each(['-wal', '-journal'])(
    'rejects an active %s without issuing SQL',
    (suffix) => {
      const database = fixture();
      fs.writeFileSync(`${database}${suffix}`, 'pending writes');
      const query = vi.fn();
      expect(() => readReadonlyMeetingSources(database, query)).toThrow(
        'source_has_uncheckpointed_writes',
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('rejects results when the source changes during the read', () => {
    const database = fixture();
    expect(() =>
      readReadonlyMeetingSources(database, () => {
        fs.writeFileSync(database, 'changed by a concurrent owner');
        return '[]';
      }),
    ).toThrow('source_changed_during_read');
  });
});
