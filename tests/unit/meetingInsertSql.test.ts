import { describe, expect, test } from 'vitest';
import { MEETING_INSERT_SQL } from '../../electron/meetingInsertSql';

const countMatches = (input: string, pattern: RegExp) =>
  (input.match(pattern) || []).length;

describe('MEETING_INSERT_SQL', () => {
  test('has one placeholder for each inserted meeting column', () => {
    const columnsSection = MEETING_INSERT_SQL.match(
      /INSERT OR REPLACE INTO meetings \(([\s\S]*?)\)\s*VALUES/i,
    )?.[1];
    expect(columnsSection).toBeTruthy();

    const columns = columnsSection
      ?.split(',')
      .map((column) => column.trim())
      .filter(Boolean);

    expect(columns).toHaveLength(27);
    expect(countMatches(MEETING_INSERT_SQL, /\?/g)).toBe(27);
  });
});
