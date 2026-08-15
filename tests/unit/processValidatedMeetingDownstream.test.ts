import { describe, expect, it, vi } from 'vitest';

import { processValidatedMeetingDownstream } from '../../src/services/processValidatedMeetingDownstream';
import type { Meeting } from '../../src/types';

describe('processValidatedMeetingDownstream', () => {
  it('analyzes the exact committed transcript without invoking ASR again', async () => {
    let meeting = {
      id: 'meeting-1',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-15T00:10:00.000Z',
      transcript_json: JSON.stringify({
        pipelineMode: 'parakeet_final_v1',
        segments: [
          { speaker: 'Me', text: 'first committed sentence' },
          { speaker: 'Them', text: 'second committed sentence' },
        ],
      }),
      transcript_integrity_json: '{}',
      downstream_processing_json: null,
    } as Meeting;
    const channels: string[] = [];
    const analysis = vi.fn(async () => ({
      markdown: 'summary',
      analysis: { ok: true },
      signals: { ok: true },
    }));
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      channels.push(channel);
      if (channel === 'GET_MEETING') return meeting;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') {
        meeting = {
          ...meeting,
          downstream_processing_json: JSON.stringify(args[1]),
        };
        return true;
      }
      if (channel === 'GENERATE_TITLE') return 'Generated title';
      if (channel === 'GENERATE_ANALYSIS_V2') return analysis(args[0]);
      if (channel === 'SAVE_MEETING') {
        meeting = args[0] as Meeting;
        return true;
      }
      if (channel === 'EXTRACT_AND_PROCESS_ENTITIES') return { ok: true };
      if (channel === 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW') {
        return { requested: 1, completed: 1 };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    const outcome = await processValidatedMeetingDownstream(meeting.id, invoke);

    expect(outcome).toEqual({ status: 'complete' });
    expect(analysis).toHaveBeenCalledWith({
      transcript:
        'Me: first committed sentence\nThem: second committed sentence',
      userNotes: '',
    });
    expect(channels.some((channel) => channel.includes('TRANSCRIBE'))).toBe(
      false,
    );
    expect(
      JSON.parse(meeting.downstream_processing_json || '{}'),
    ).toMatchObject({ state: 'complete' });
  });
});
