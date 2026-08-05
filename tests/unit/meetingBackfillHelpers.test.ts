import { describe, expect, it } from 'vitest';

import {
  buildMeetingWhereClause,
  parseBackfillArgs,
  resolvePlutoDbPath,
} from '../../scripts/lib/meeting_backfill_helpers.js';

describe('meeting intelligence backfill helpers', () => {
  it('defaults to dry-run mode', () => {
    expect(parseBackfillArgs([])).toEqual({
      dryRun: true,
      write: false,
      titleOnly: false,
      dbPath: null,
      meetingId: null,
      title: null,
    });
  });

  it('parses title-only repair mode', () => {
    expect(
      parseBackfillArgs(['--write', '--title-only', '--meeting-id', 'abc']),
    ).toMatchObject({ write: true, titleOnly: true, meetingId: 'abc' });
  });

  it('parses write mode and meeting id target', () => {
    expect(parseBackfillArgs(['--write', '--meeting-id', 'abc'])).toMatchObject(
      {
        dryRun: false,
        write: true,
        meetingId: 'abc',
      },
    );
  });

  it('prefers an explicit database path', () => {
    expect(
      resolvePlutoDbPath({
        explicitDbPath: '/tmp/custom.db',
        env: { PLUTO_DB_PATH: '/tmp/env.db' },
      }),
    ).toBe('/tmp/custom.db');
  });

  it('uses PLUTO_DB_PATH when no explicit database path is provided', () => {
    expect(
      resolvePlutoDbPath({
        env: { PLUTO_DB_PATH: '/tmp/env.db' },
      }),
    ).toBe('/tmp/env.db');
  });

  it('resolves the macOS app support database path by default', () => {
    expect(
      resolvePlutoDbPath({
        platform: 'darwin',
        homeDir: '/Users/example',
        appName: 'pluto',
        env: {},
      }),
    ).toBe('/Users/example/Library/Application Support/pluto/pluto.db');
  });

  it('builds a meeting id where clause', () => {
    expect(buildMeetingWhereClause({ meetingId: 'abc', title: null })).toEqual({
      clause: 'WHERE id = ?',
      params: ['abc'],
      description: 'meeting id abc',
    });
  });

  it('builds a title search where clause', () => {
    expect(buildMeetingWhereClause({ meetingId: null, title: 'Flu' })).toEqual({
      clause: 'WHERE title LIKE ?',
      params: ['%Flu%'],
      description: 'title containing "Flu"',
    });
  });

  it('rejects empty write targets', () => {
    expect(() =>
      buildMeetingWhereClause({ meetingId: null, title: null }),
    ).toThrow('Provide --meeting-id or --title');
  });
});
