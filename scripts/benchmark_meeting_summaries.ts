import {
  assertMeetingSummaryPayload,
  measureMeetingSummaryPayload,
} from './lib/meeting_summary_benchmark.ts';

const summaries = Array.from({ length: 100 }, (_, index) => ({
  id: `synthetic-${index}`,
  title: `Representative meeting ${index}`,
  created_at: '2026-09-01T12:00:00.000Z',
  started_at: '2026-09-01T12:00:00.000Z',
  duration_seconds: 1_800,
  transcript_status: 'validated',
  finalization_status: 'finalized',
  downstream_processing_json: null,
  analysis_run_json: null,
  has_transcript: true,
  has_transcript_text: true,
  has_audio: true,
  has_analysis: true,
}));

assertMeetingSummaryPayload(summaries);
const report = {
  schemaVersion: 1,
  kind: 'synthetic_content_free',
  ...measureMeetingSummaryPayload(summaries),
  transcriptSizeInvariant: true,
};
if (!report.underBudget)
  throw new Error('meeting_summary_payload_budget_failed');
console.log(JSON.stringify(report, null, 2));
