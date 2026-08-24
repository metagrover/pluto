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
          { speaker: 'Me', text: 'um first committed sentence' },
          { speaker: 'Them', text: 'second uh committed sentence' },
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
    expect(analysis).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript:
          'Me: first committed sentence\nThem: second committed sentence',
        userNotes: '',
        requestId: expect.stringMatching(/:analysis$/),
      }),
    );
    expect(channels.some((channel) => channel.includes('TRANSCRIBE'))).toBe(
      false,
    );
    expect(
      JSON.parse(meeting.downstream_processing_json || '{}'),
    ).toMatchObject({ state: 'complete' });
  });

  it('cancels timed-out analysis before persisting a bounded failure', async () => {
    let meeting = {
      id: 'meeting-timeout',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-15T00:10:00.000Z',
      transcript_json: JSON.stringify({
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      transcript_integrity_json: '{}',
      downstream_processing_json: null,
    } as Meeting;
    let finishAnalysis: (() => void) | null = null;
    const channels: string[] = [];
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
      if (channel === 'GENERATE_ANALYSIS_V2') {
        await new Promise<void>((resolve) => {
          finishAnalysis = resolve;
        });
        throw new DOMException('Analysis cancelled', 'AbortError');
      }
      if (channel === 'CANCEL_ANALYSIS_GENERATION') {
        finishAnalysis?.();
        return { cancelled: true };
      }
      if (channel === 'SAVE_MEETING') {
        meeting = args[0] as Meeting;
        return true;
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    const outcome = await processValidatedMeetingDownstream(
      meeting.id,
      invoke,
      { stageTimeoutMs: { analysis: 5 } },
    );

    expect(outcome).toEqual({ status: 'failed' });
    expect(channels.indexOf('CANCEL_ANALYSIS_GENERATION')).toBeGreaterThan(
      channels.indexOf('GENERATE_ANALYSIS_V2'),
    );
    expect(
      JSON.parse(meeting.downstream_processing_json || '{}'),
    ).toMatchObject({
      state: 'failed',
      stage: 'analysis',
      failure: 'stage_timeout',
      attempt: 1,
    });
  });

  it('persists provider fallback as a bounded generation failure', async () => {
    let meeting = {
      id: 'meeting-fallback',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      transcript_status: 'validated',
      transcript_validated_at: '2026-08-15T00:10:00.000Z',
      transcript_json: JSON.stringify({
        segments: [{ speaker: 'Me', text: 'Synthetic statement.' }],
      }),
      transcript_integrity_json: '{}',
      downstream_processing_json: null,
    } as Meeting;
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_MEETING') return meeting;
      if (channel === 'CLAIM_DOWNSTREAM_PROCESSING') {
        meeting = {
          ...meeting,
          downstream_processing_json: JSON.stringify(args[1]),
        };
        return true;
      }
      if (channel === 'GENERATE_ANALYSIS_V2') {
        return { analysis: { quality: { fallback_used: true } } };
      }
      if (channel === 'SAVE_MEETING') {
        meeting = args[0] as Meeting;
        return true;
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      processValidatedMeetingDownstream(meeting.id, invoke),
    ).resolves.toEqual({ status: 'failed' });
    expect(
      JSON.parse(meeting.downstream_processing_json || '{}'),
    ).toMatchObject({
      state: 'failed',
      stage: 'analysis',
      failure: 'generation_failed',
      attempt: 1,
    });
  });
});
