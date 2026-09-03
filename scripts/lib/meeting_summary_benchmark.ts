const DETAIL_ONLY_FIELDS = new Set([
  'transcript_json',
  'analysis_json',
  'enhanced_notes',
  'user_notes',
  'audio_path',
  'system_audio_path',
  'mixed_audio_path',
  'user_edits_json',
  'analysis_edit_conflicts_json',
  'value_signals_json',
  'follow_up_drafts_json',
  'mid_json',
  'dashboard_detail',
  'recent_win_title',
  'recent_win_why',
  'recent_win_evidence',
  'recent_win_source',
]);

export const assertMeetingSummaryPayload = (
  summaries: readonly Record<string, unknown>[],
): void => {
  for (const summary of summaries) {
    for (const field of Object.keys(summary)) {
      if (DETAIL_ONLY_FIELDS.has(field)) {
        throw new Error('meeting_summary_contains_detail_field');
      }
    }
  }
};

export const measureMeetingSummaryPayload = (
  summaries: readonly Record<string, unknown>[],
) => {
  assertMeetingSummaryPayload(summaries);
  const serializedBytes = Buffer.byteLength(JSON.stringify(summaries), 'utf8');
  return {
    meetingCount: summaries.length,
    serializedBytes,
    budgetBytes: 100 * 1024,
    underBudget: serializedBytes < 100 * 1024,
  };
};
