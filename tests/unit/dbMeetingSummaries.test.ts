import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-summaries-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  getMeetingDashboardPreviews,
  getMeetingProcessingStatuses,
  getMeetingSummaries,
  saveMeeting,
  searchMeetingSummaries,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const detailOnlyFields = [
  'transcript_json',
  'analysis_json',
  'enhanced_notes',
  'user_notes',
  'audio_path',
  'system_audio_path',
  'mixed_audio_path',
  'user_edits_json',
  'analysis_edit_conflicts_json',
];

describe('meeting summary read model', () => {
  it('preserves newest-first list metadata while excluding private detail fields', () => {
    saveMeeting({
      id: 'summary-older',
      title: 'Older meeting',
      started_at: '2026-09-01T10:00:00.000Z',
      transcript_json: JSON.stringify({
        segments: [{ speaker: 1, text: 'PRIVATE TRANSCRIPT' }],
      }),
      analysis_json: JSON.stringify({
        overview: 'Bounded overview',
        recent_win: {
          win: 'Shipped',
          why_it_counts: 'Customer accepted it',
          evidence: 'Private evidence',
          source: 'Review',
        },
      }),
      enhanced_notes: 'PRIVATE NOTES',
      user_notes: 'PRIVATE USER NOTES',
      audio_path: '/private/mic.wav',
      transcript_status: 'validated',
      finalization_status: 'finalized',
    });
    saveMeeting({
      id: 'summary-newer',
      title: 'Newer meeting',
      started_at: '2026-09-01T11:00:00.000Z',
      transcript_json: JSON.stringify({ segments: [] }),
      transcript_status: 'provisional',
      finalization_status: 'finalized',
    });

    const summaries = getMeetingSummaries();

    expect(summaries.map((meeting) => meeting.id)).toEqual([
      'summary-newer',
      'summary-older',
    ]);
    expect(summaries[1]).toMatchObject({
      title: 'Older meeting',
      transcript_status: 'validated',
      has_transcript: true,
      has_transcript_text: true,
      has_audio: true,
      has_analysis: true,
    });
    for (const summary of summaries) {
      for (const field of detailOnlyFields) {
        expect(summary).not.toHaveProperty(field);
      }
    }
    expect(JSON.stringify(summaries)).not.toContain('PRIVATE');
    expect(JSON.stringify(summaries)).not.toContain('/private/');
    expect(summaries[0]).not.toHaveProperty('has_capture_gap');
    expect(getMeetingDashboardPreviews()).toContainEqual(
      expect.objectContaining({
        id: 'summary-older',
        dashboard_detail: 'Bounded overview',
        recent_win_title: 'Shipped',
      }),
    );
  });

  it('reads integrity-derived processing state only through the bounded status model', () => {
    saveMeeting({
      id: 'processing-status',
      title: 'Meeting',
      started_at: '2026-09-01T12:30:00.000Z',
      transcript_status: 'needs_attention',
      transcript_integrity_json: JSON.stringify({
        causes: [{ code: 'capture_gap_detected' }],
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'needs_attention',
        },
      }),
    });

    expect(getMeetingProcessingStatuses()).toContainEqual({
      id: 'processing-status',
      has_capture_gap: true,
      final_transcription_policy: 'parakeet_final_v1',
      final_transcription_state: 'needs_attention',
      final_transcription_engine: null,
      automatic_attempts_exhausted: false,
    });
  });

  it('searches private note text while returning result metadata only', () => {
    saveMeeting({
      id: 'search-notes',
      title: 'Unrelated title',
      started_at: '2026-09-01T12:00:00.000Z',
      user_notes: 'Remember the heliotrope follow-up.',
    });

    expect(searchMeetingSummaries('heliotrope', 5)).toEqual([
      {
        id: 'search-notes',
        title: 'Unrelated title',
        started_at: '2026-09-01T12:00:00.000Z',
        created_at: expect.any(String),
      },
    ]);
    expect(
      JSON.stringify(searchMeetingSummaries('heliotrope', 5)),
    ).not.toContain('Remember the');
  });

  it('does not grow the list payload when transcript detail grows', () => {
    const meeting = {
      id: 'summary-size-invariant',
      title: 'Size invariant',
      started_at: '2026-09-01T13:00:00.000Z',
      transcript_status: 'validated' as const,
    };
    saveMeeting({
      ...meeting,
      transcript_json: JSON.stringify({
        segments: [{ speaker: 1, text: 'short' }],
      }),
    });
    const shortPayload = JSON.stringify(
      getMeetingSummaries().find((item) => item.id === meeting.id),
    ).length;

    saveMeeting({
      ...meeting,
      transcript_json: JSON.stringify({
        segments: [{ speaker: 1, text: 'long '.repeat(20_000) }],
      }),
    });
    const longPayload = JSON.stringify(
      getMeetingSummaries().find((item) => item.id === meeting.id),
    ).length;

    expect(longPayload).toBe(shortPayload);
  });
});
