import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlutoMcpDataSource } from '../../electron/mcp/meetingTools';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`CREATE TABLE meetings (
    id TEXT PRIMARY KEY, title TEXT, started_at TEXT, created_at TEXT,
    user_notes TEXT, enhanced_notes TEXT, analysis_json TEXT,
    user_edits_json TEXT, analysis_format_pass INTEGER,
    transcript_json TEXT, audio_path TEXT, mid_json TEXT
  )`);
  const queries: string[] = [];
  let pageReads = 0;
  const readDatabase = {
    prepare(sql: string) {
      queries.push(sql);
      const statement = database.prepare(sql);
      return {
        all(...parameters: (string | number)[]) {
          pageReads += 1;
          return statement.all(...parameters);
        },
        get(...parameters: (string | number)[]) {
          return statement.get(...parameters);
        },
      };
    },
  };
  const insert = (id: string, notes: string, date = '2026-01-01') => {
    database
      .prepare(`INSERT INTO meetings
      (id,title,created_at,enhanced_notes,transcript_json,audio_path,mid_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        `Review ${id}`,
        date,
        notes,
        'PRIVATE_TRANSCRIPT_SENTINEL',
        '/PRIVATE_AUDIO_SENTINEL.wav',
        JSON.stringify({
          decisions: [{ description: 'PRIVATE_MID_SENTINEL' }],
        }),
      );
  };
  return {
    database,
    queries,
    readPageCount: () => pageReads,
    insert,
    source: createPlutoMcpDataSource(readDatabase),
  };
}

function analysis(overview: string) {
  return JSON.stringify({
    analysis_schema_version: 3,
    overview,
    topics: [],
    all_decisions: [],
    all_action_items: [],
    meeting_type: 'general',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
    generation_metadata: { private_debug_value: 'PRIVATE_ANALYSIS_SENTINEL' },
  });
}

describe('read-only meeting MCP notes adapter', () => {
  it('stops querying the database when the request is cancelled between batches', async () => {
    const { insert, source, readPageCount } = fixture();
    for (let index = 0; index < 105; index++) {
      insert(String(index).padStart(3, '0'), 'Shared plan');
    }
    const controller = new AbortController();
    const search = Promise.resolve(
      source.searchMeetings({ query: 'Shared' }, controller.signal),
    );
    const rejection = expect(search).rejects.toThrow('Search cancelled');
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new Error('Search cancelled'));
    await rejection;
    const readsAtCancellation = readPageCount();
    expect(readsAtCancellation).toBeGreaterThan(0);
    expect(readsAtCancellation).toBeLessThan(11);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(readPageCount()).toBe(readsAtCancellation);
    await expect(
      source.searchMeetings({ query: 'Shared' }, controller.signal),
    ).rejects.toThrow('Search cancelled');
    expect(readPageCount()).toBe(readsAtCancellation);
  });

  it('yields to main-thread callbacks and finishes scanning beyond the returned page', async () => {
    const { insert, source } = fixture();
    for (let index = 0; index < 105; index++) {
      insert(String(index).padStart(3, '0'), 'Shared plan');
    }
    let completed = false;
    const search = Promise.resolve(
      source.searchMeetings({ query: 'Shared', limit: 1 }),
    ).then((result) => {
      completed = true;
      return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(await search).toMatchObject({
      total: 105,
      scanComplete: true,
      nextOffset: 1,
    });
    expect(completed).toBe(true);
  });

  it('returns only allowlisted notes and metadata and performs only read queries', async () => {
    const { database, queries, insert, source } = fixture();
    insert('a', 'Settled plan.');
    database
      .prepare('UPDATE meetings SET analysis_json = ? WHERE id = ?')
      .run(analysis('Published overview.'), 'a');
    const before = database.prepare('SELECT * FROM meetings').all();
    const output = JSON.stringify([
      source.listMeetings({}),
      await source.searchMeetings({ query: 'Published' }),
      source.getMeeting({ meetingId: 'a' }),
    ]);
    expect(output).toContain('Published overview.');
    expect(output).not.toContain('PRIVATE_');
    expect(output).not.toMatch(
      /analysis_json|user_edits_json|transcript_json|audio_path|evidenceReferences/,
    );
    expect(queries.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
    expect(queries.join('\n')).not.toMatch(
      /SELECT\s+\*|transcript|audio|mid_json/i,
    );
    expect(database.prepare('SELECT * FROM meetings').all()).toEqual(before);
  });

  it('reads replacements and removals freshly without searching original or stale notes', async () => {
    const { database, insert, source } = fixture();
    insert('edited', 'Stale overview.');
    database
      .prepare(
        'UPDATE meetings SET analysis_json = ?, user_edits_json = ? WHERE id = ?',
      )
      .run(
        analysis('Original overview.'),
        JSON.stringify({
          overview: {
            original: 'Original overview.',
            edited: 'Replacement overview.',
            edited_at: '2026-01-02T00:00:00.000Z',
          },
        }),
        'edited',
      );
    expect(source.getMeeting({ meetingId: 'edited' }).notes).toBe(
      'Replacement overview.',
    );
    expect((await source.searchMeetings({ query: 'Replacement' })).total).toBe(
      1,
    );
    expect((await source.searchMeetings({ query: 'Original' })).total).toBe(0);
    expect((await source.searchMeetings({ query: 'Stale' })).total).toBe(0);
    const revision = source.getMeeting({ meetingId: 'edited' }).sourceRevision;
    database
      .prepare('UPDATE meetings SET user_edits_json = ? WHERE id = ?')
      .run(
        JSON.stringify({
          overview: {
            original: 'Original overview.',
            edited: '',
            edited_at: '2026-01-03T00:00:00.000Z',
          },
        }),
        'edited',
      );
    const deleted = source.getMeeting({ meetingId: 'edited' });
    expect(deleted.notes).toBe('');
    expect(deleted.hasNotes).toBe(false);
    expect(deleted.sourceRevision).not.toBe(revision);
    expect((await source.searchMeetings({ query: 'Replacement' })).total).toBe(
      0,
    );
    database.prepare('DELETE FROM meetings WHERE id = ?').run('edited');
    expect(source.listMeetings({}).total).toBe(0);
    expect(() => source.getMeeting({ meetingId: 'edited' })).toThrow(
      'Meeting not found',
    );
  });

  it('treats SQL, wildcard and FTS syntax as literal plain text', async () => {
    const { insert, source } = fixture();
    insert("a' OR 1=1 --", "Discuss 50%_cost, O'Reilly, and NEAR(x y).");
    insert('b', 'Ordinary notes.');
    expect((await source.searchMeetings({ query: '50%_cost' })).total).toBe(1);
    expect((await source.searchMeetings({ query: "O'Reilly" })).total).toBe(1);
    expect((await source.searchMeetings({ query: 'NEAR(x y)' })).total).toBe(1);
    expect((await source.searchMeetings({ query: "' OR 1=1 --" })).total).toBe(
      1,
    );
    expect(source.getMeeting({ meetingId: "a' OR 1=1 --" }).notes).toContain(
      '50%_cost',
    );
    expect(() => source.getMeeting({ meetingId: "' OR 1=1 --" })).toThrow(
      'Meeting not found',
    );
  });

  it('paginates all meetings deterministically, including search matches beyond the scan page', async () => {
    const { insert, source } = fixture();
    for (let index = 0; index < 105; index++) {
      insert(String(index).padStart(3, '0'), `Shared plan ${index}`);
    }
    const first = source.listMeetings({ limit: 2 });
    expect(first).toMatchObject({
      total: 105,
      nextOffset: 2,
      limit: 2,
      offset: 0,
    });
    expect(
      (first.meetings as { meetingId: string }[]).map((row) => row.meetingId),
    ).toEqual(['000', '001']);
    expect(source.listMeetings({ limit: 2, offset: 104 })).toMatchObject({
      nextOffset: null,
    });
    const search = await source.searchMeetings({
      query: 'Shared',
      limit: 3,
      offset: 101,
    });
    expect(search).toMatchObject({ total: 105, nextOffset: 104 });
    expect(
      (search.meetings as { meetingId: string }[]).map((row) => row.meetingId),
    ).toEqual(['101', '102', '103']);
    expect(source.listMeetings({ limit: 200 }).limit).toBe(100);
    expect(source.listMeetings({ offset: 200 }).meetings).toEqual([]);
  });

  it('paginates notes characters and supplies stable source IDs and bounded snippets', async () => {
    const { insert, source } = fixture();
    const notes = `${'x'.repeat(800)} needle ${'y'.repeat(800)}`;
    insert('id/space here', notes);
    const first = source.getMeeting({ meetingId: 'id/space here', limit: 800 });
    expect(first).toMatchObject({
      sourceId: 'pluto://meetings/id%2Fspace%20here/notes',
      date: '2026-01-01',
      totalCharacters: notes.length,
      nextOffset: 800,
    });
    const second = source.getMeeting({
      meetingId: 'id/space here',
      offset: 800,
      limit: 20000,
    });
    expect(String(first.notes) + String(second.notes)).toBe(notes);
    expect(second.nextOffset).toBe(null);
    expect(
      source.getMeeting({ meetingId: 'id/space here', limit: 50000 }).limit,
    ).toBe(20000);
    const hit = (
      (await source.searchMeetings({ query: 'needle' })).meetings as {
        snippet: string;
      }[]
    )[0];
    expect(hit.snippet).toContain('needle');
    expect(hit.snippet.length).toBeLessThanOrEqual(502);
  });

  it('validates empty searches and invalid pagination values', async () => {
    const { source } = fixture();
    await expect(source.searchMeetings({ query: ' ' })).rejects.toThrow(
      'non-empty',
    );
    await expect(
      source.searchMeetings({ query: 'x'.repeat(1001) }),
    ).rejects.toThrow('1000');
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => source.listMeetings({ limit })).toThrow('Pagination');
    }
    expect(() => source.listMeetings({ offset: -1 })).toThrow('Pagination');
    expect(() => source.getMeeting({ meetingId: '' })).toThrow('meeting ID');
  });
});
