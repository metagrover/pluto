import { describe, expect, it } from 'vitest';
import {
  assertMeetingSummaryPayload,
  measureMeetingSummaryPayload,
} from '../../scripts/lib/meeting_summary_benchmark';

describe('meeting summary payload benchmark', () => {
  it('keeps 100 summaries below 100 KB and invariant to detail blob size', () => {
    const summaries = Array.from({ length: 100 }, (_, index) => ({
      id: `meeting-${index}`,
      title: `Meeting ${index}`,
      started_at: '2026-09-01T11:00:00.000Z',
      duration_seconds: 1_800,
      transcript_status: 'validated',
      finalization_status: 'finalized',
      has_transcript: true,
      has_transcript_text: true,
      has_audio: true,
      has_analysis: true,
    }));

    expect(measureMeetingSummaryPayload(summaries)).toMatchObject({
      meetingCount: 100,
      underBudget: true,
    });
    expect(
      measureMeetingSummaryPayload(summaries).serializedBytes,
    ).toBeLessThan(100 * 1024);
    expect(() => assertMeetingSummaryPayload(summaries)).not.toThrow();
    expect(() =>
      assertMeetingSummaryPayload([
        { ...summaries[0], transcript_json: 'private'.repeat(100_000) },
      ]),
    ).toThrow('meeting_summary_contains_detail_field');
  });
});
