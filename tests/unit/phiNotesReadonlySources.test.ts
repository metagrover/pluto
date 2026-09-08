import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readReadonlyMeetingSources } from '../../scripts/lib/phi_notes_readonly_sources.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
const fixture = () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'phi-readonly-unit-')),
  );
  roots.push(root);
  const database = path.join(root, 'source.db');
  fs.writeFileSync(database, 'unchanged source');
  return database;
};
describe('read-only notes sources', () => {
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
