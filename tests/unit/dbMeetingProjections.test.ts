import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-projections-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  db,
  getAskPlutoMeetingHeaders,
  getAskPlutoMeetings,
  getAskPlutoMeetingsByIds,
  getAudioLifecycleMeetings,
  getMeetings,
  getProjectSynthesisMeetings,
  getSuggestedQueryMeetings,
  saveMeeting,
} from '../../electron/db';
import { createAskPlutoMeetingSource } from '../../electron/intelligence/askPlutoMeetingSource';
import {
  buildAssigneeActionRecall,
  selectWorkspaceRecallCandidates,
} from '../../electron/intelligence/queryEngine';

const TRANSCRIPT = 'RAW_TRANSCRIPT_SENTINEL';
const ids = (rows: Array<{ id: string | number }>) =>
  rows.map((row) => String(row.id));
const planFor = (query: string) =>
  (
    db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{
      detail: string;
    }>
  )
    .map((row) => row.detail)
    .join('\n');

beforeAll(() => {
  for (let index = 0; index < 14; index += 1)
    saveMeeting({
      id: `projection-${index}`,
      title: `Planning ${index}`,
      // Two meetings share a start time to pin the tie order.
      started_at: `2026-09-${String(10 + Math.min(index, 12)).padStart(2, '0')}T10:00:00.000Z`,
      transcript_json: JSON.stringify({ text: TRANSCRIPT }),
      audio_path: `/private/audio-${index}.wav`,
      user_notes: `user notes ${index}`,
      enhanced_notes: `enhanced notes ${index}`,
      analysis_json: JSON.stringify({ overview: `overview ${index}` }),
      mid_json: JSON.stringify({ topics: [{ name: 'Planning' }] }),
      transcript_status: 'validated',
      finalization_status: 'finalized',
    });
});

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('narrow meeting reads', () => {
  it('reads project synthesis sources without transcripts or audio', () => {
    const all = getMeetings() as Array<{ id: string }>;
    const sources = getProjectSynthesisMeetings();
    expect(ids(sources)).toEqual(ids(all));
    expect(JSON.stringify(sources)).not.toContain(TRANSCRIPT);
    expect(JSON.stringify(sources)).not.toContain('/private/audio');
    expect(sources[0]).toMatchObject({
      user_notes: expect.any(String),
      enhanced_notes: expect.any(String),
      analysis_json: expect.any(String),
      mid_json: expect.any(String),
    });
    expect(Object.keys(sources[0]).sort()).toEqual(
      [
        'analysis_format_pass',
        'analysis_json',
        'created_at',
        'enhanced_notes',
        'id',
        'mid_json',
        'started_at',
        'title',
        'user_edits_json',
        'user_notes',
      ].sort(),
    );
  });

  it('limits project synthesis to selected meetings in history order', () => {
    const selected = new Set(['projection-2', 'projection-9', 'missing']);
    expect(ids(getProjectSynthesisMeetings(selected))).toEqual(
      ids(getMeetings() as Array<{ id: string }>).filter((id) =>
        selected.has(id),
      ),
    );
    expect(getProjectSynthesisMeetings(new Set())).toEqual([]);
  });

  it('reads audio lifecycle state without transcripts or notes', () => {
    const all = getMeetings() as Array<Record<string, unknown>>;
    const meetings = getAudioLifecycleMeetings();
    expect(ids(meetings)).toEqual(ids(all as Array<{ id: string }>));
    const serialized = JSON.stringify(meetings);
    expect(serialized).not.toContain(TRANSCRIPT);
    expect(serialized).not.toContain('user notes');
    for (const [index, meeting] of meetings.entries())
      for (const [column, value] of Object.entries(meeting))
        expect(value).toEqual(all[index][column]);
    expect(meetings[0].audio_path).toMatch(/^\/private\/audio-/);
  });

  it('reads only the recent meetings suggested questions use', () => {
    const recent = getSuggestedQueryMeetings(10);
    expect(ids(recent)).toEqual(
      ids(getMeetings() as Array<{ id: string }>).slice(0, 10),
    );
    expect(JSON.stringify(recent)).not.toContain(TRANSCRIPT);
  });

  it('answers Ask Pluto headers from the covering index', () => {
    expect(
      planFor(`SELECT id, title, started_at, created_at, finalization_status,
              downstream_processing_json FROM meetings
       ORDER BY COALESCE(started_at, created_at) DESC`),
    ).toContain('COVERING INDEX idx_meetings_headers');
    expect(ids(getAskPlutoMeetingHeaders())).toEqual(
      ids(getAskPlutoMeetings()),
    );
  });

  it('loads Ask Pluto rows by id without transcripts', () => {
    const rows = getAskPlutoMeetingsByIds(['projection-3', 'projection-1']);
    expect(ids(rows).sort()).toEqual(['projection-1', 'projection-3']);
    expect(JSON.stringify(rows)).not.toContain(TRANSCRIPT);
    expect(rows.find((row) => row.id === 'projection-3')).toEqual(
      getAskPlutoMeetings().find((row) => row.id === 'projection-3'),
    );
    expect(getAskPlutoMeetingsByIds([])).toEqual([]);
  });
});

describe('Ask Pluto meeting source', () => {
  const reader = () => {
    const calls = { all: 0, byIds: [] as string[][] };
    return {
      calls,
      reader: {
        getAskPlutoMeetingHeaders,
        getAskPlutoMeetings: () => {
          calls.all += 1;
          return getAskPlutoMeetings();
        },
        getAskPlutoMeetingsByIds: (input: readonly (string | number)[]) => {
          calls.byIds.push(input.map(String));
          return getAskPlutoMeetingsByIds(input);
        },
      },
    };
  };

  it('reads only headers until a step needs notes', () => {
    const { calls, reader: source } = reader();
    const meetings = createAskPlutoMeetingSource(source);
    expect(ids([...meetings.headers])).toEqual(ids(getAskPlutoMeetings()));
    expect(meetings.headers[0]).not.toHaveProperty('analysis_json');
    expect(calls).toEqual({ all: 0, byIds: [] });
  });

  it('hydrates chosen meetings in the order given, reading each once', () => {
    const { calls, reader: source } = reader();
    const meetings = createAskPlutoMeetingSource(source);
    const chosen = [meetings.headers[4], meetings.headers[1]];
    const rows = meetings.hydrate(chosen);
    expect(ids(rows)).toEqual(ids(chosen));
    expect(rows[0]).toEqual(
      getAskPlutoMeetings().find((row) => row.id === chosen[0].id),
    );
    meetings.hydrate([meetings.headers[1]]);
    expect(calls.byIds).toEqual([ids(chosen)]);
    expect(meetings.hydrate([{ id: 'missing' }])).toEqual([]);
  });

  it('matches a full read when every meeting is needed', () => {
    const { calls, reader: source } = reader();
    const meetings = createAskPlutoMeetingSource(source);
    expect(meetings.all()).toEqual(getAskPlutoMeetings());
    expect(meetings.all()).toBe(meetings.all());
    meetings.hydrate(meetings.headers.slice(0, 3));
    expect(calls).toEqual({ all: 1, byIds: [] });
  });
});

describe('Ask Pluto steps that need every meeting', () => {
  it('does not read meetings for a question that names no assignee', () => {
    const readAll = vi.fn(() => getAskPlutoMeetings());
    expect(
      buildAssigneeActionRecall('What did we decide about pricing?', readAll),
    ).toBeNull();
    expect(readAll).not.toHaveBeenCalled();
  });

  it('gives the same assignee answer from a reader as from a full list', () => {
    const query = 'What is assigned to Morgan?';
    const readAll = vi.fn(() => getAskPlutoMeetings());
    expect(buildAssigneeActionRecall(query, readAll)).toEqual(
      buildAssigneeActionRecall(query, getAskPlutoMeetings()),
    );
    expect(readAll).toHaveBeenCalledTimes(1);
  });

  it('chooses workspace recall candidates from headers within the recent window', () => {
    const now = Date.parse('2026-09-24T12:00:00.000Z');
    const candidates = selectWorkspaceRecallCandidates(
      getAskPlutoMeetingHeaders(),
      now,
    );
    expect(ids(candidates)).toEqual(
      ids(getAskPlutoMeetingHeaders()).filter((id) => {
        const meeting = getAskPlutoMeetings().find((row) => row.id === id);
        return Date.parse(meeting?.started_at ?? '') >= now - 14 * 864e5;
      }),
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(14);
  });
});
