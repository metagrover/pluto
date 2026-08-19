import { describe, expect, it } from 'vitest';

import type { Meeting, UserEditsMap } from '../../src/types';
import {
  ANALYSIS_SNAPSHOT_PATH,
  createAnalysisSnapshot,
  restoreAnalysisSnapshot,
} from '../../src/utils/meetingNotesHistory';

const meeting: Meeting = {
  id: 'history-meeting',
  title: 'Planning',
  created_at: '2026-08-19T10:00:00.000Z',
  started_at: '2026-08-19T10:00:00.000Z',
  enhanced_notes: 'Previous markdown',
  analysis_json: '{"analysis_schema_version":3}',
  analysis_schema_version: 3,
  analysis_format_pass: true,
  user_edits_json: JSON.stringify({
    overview: {
      original: 'Old overview',
      edited: 'User wording',
      edited_at: '2026-08-18T10:00:00.000Z',
    },
  }),
};

describe('meeting notes regeneration history', () => {
  it('stores the previous generated document without dropping user edits', () => {
    const edits = createAnalysisSnapshot(meeting, '2026-08-19T11:00:00.000Z');

    expect(edits.overview.edited).toBe('User wording');
    expect(edits[ANALYSIS_SNAPSHOT_PATH]).toEqual({
      original: 'Previous markdown',
      edited: '{"analysis_schema_version":3}',
      edited_at: '2026-08-19T11:00:00.000Z',
    });
  });

  it('restores the previous document and consumes the snapshot', () => {
    const edits = createAnalysisSnapshot(meeting, '2026-08-19T11:00:00.000Z');
    const restored = restoreAnalysisSnapshot({
      ...meeting,
      enhanced_notes: 'New markdown',
      analysis_json: '{"analysis_schema_version":3,"overview":"New"}',
      user_edits_json: JSON.stringify(edits),
    });

    expect(restored).toMatchObject({
      enhanced_notes: 'Previous markdown',
      analysis_json: '{"analysis_schema_version":3}',
    });
    const remaining = JSON.parse(
      restored?.user_edits_json || '{}',
    ) as UserEditsMap;
    expect(remaining[ANALYSIS_SNAPSHOT_PATH]).toBeUndefined();
    expect(remaining.overview.edited).toBe('User wording');
  });

  it('returns null when no recoverable rewrite exists', () => {
    expect(
      restoreAnalysisSnapshot({ ...meeting, user_edits_json: '{}' }),
    ).toBeNull();
  });
});
