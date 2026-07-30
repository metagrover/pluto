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

    expect(columns?.length).toBeGreaterThan(0);
    expect(countMatches(MEETING_INSERT_SQL, /\?/g)).toBe(columns?.length ?? 0);
    expect(columns).toContain('created_at');
    expect(columns).toContain('transcript_status');
    expect(columns).toContain('transcript_integrity_json');
    expect(columns).toContain('system_audio_path');
    expect(columns).toContain('mixed_audio_path');
    expect(columns).toContain('transcript_validated_at');
    expect(columns).toContain('finalization_status');
    expect(columns).toContain('finalization_error_category');
    expect(columns).toContain('downstream_processing_json');
    expect(MEETING_INSERT_SQL).toContain('COALESCE(?, CURRENT_TIMESTAMP)');
  });
});
