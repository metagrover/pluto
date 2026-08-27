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
    expect(edits[ANALYSIS_SNAPSHOT_PATH]?.original).toBe('Previous markdown');
    expect(
      JSON.parse(edits[ANALYSIS_SNAPSHOT_PATH]?.edited || '{}'),
    ).toMatchObject({
      schema_version: 1,
      analysis_json: '{"analysis_schema_version":3}',
      user_edits_json: meeting.user_edits_json,
      analysis_edit_conflicts_json: '[]',
      generation_metadata: null,
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

  it('round-trips the matching edit map, conflicts, and generation provenance', () => {
    const snapshot = createAnalysisSnapshot(
      {
        ...meeting,
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          generation_metadata: { source_provenance: { source_revision: 'r1' } },
        }),
        analysis_edit_conflicts_json: JSON.stringify([
          {
            path: 'overview',
            original: 'Original',
            edited: 'Saved wording',
            edited_at: '2026-08-18T10:00:00.000Z',
            previousSourceKey: 'overview-source',
          },
        ]),
      },
      '2026-08-19T11:00:00.000Z',
    );
    const restored = restoreAnalysisSnapshot({
      ...meeting,
      enhanced_notes: 'New markdown',
      analysis_json: '{"analysis_schema_version":3,"overview":"New"}',
      user_edits_json: JSON.stringify(snapshot),
      analysis_edit_conflicts_json: '[]',
    });

    expect(restored?.user_edits_json).toBe(meeting.user_edits_json);
    expect(restored?.analysis_edit_conflicts_json).toContain('Saved wording');
    expect(restored?.analysis_json).toContain('source_provenance');
  });

  it('restores the legacy raw-analysis snapshot format', () => {
    const restored = restoreAnalysisSnapshot({
      ...meeting,
      enhanced_notes: 'New markdown',
      analysis_json: '{"analysis_schema_version":3,"overview":"New"}',
      user_edits_json: JSON.stringify({
        overview: {
          original: 'Old overview',
          edited: 'User wording',
          edited_at: '2026-08-18T10:00:00.000Z',
        },
        [ANALYSIS_SNAPSHOT_PATH]: {
          original: 'Previous markdown',
          edited: '{"analysis_schema_version":3,"overview":"Old"}',
          edited_at: '2026-08-19T11:00:00.000Z',
        },
      }),
    });

    expect(restored).toMatchObject({
      enhanced_notes: 'Previous markdown',
      analysis_json: '{"analysis_schema_version":3,"overview":"Old"}',
      user_edits_json: meeting.user_edits_json,
    });
  });

  it('returns null when no recoverable rewrite exists', () => {
    expect(
      restoreAnalysisSnapshot({ ...meeting, user_edits_json: '{}' }),
    ).toBeNull();
  });
});
