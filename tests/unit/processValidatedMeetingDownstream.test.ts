import { describe, expect, it, vi } from 'vitest';

import { processValidatedMeetingDownstream } from '../../src/services/processValidatedMeetingDownstream';
import type { Meeting } from '../../src/types';

const validatedMeeting = {
  id: 'meeting-coordinator',
  title: 'Meaningful title',
  created_at: '2026-08-15T00:00:00.000Z',
  started_at: '2026-08-15T00:00:00.000Z',
  transcript_status: 'validated',
  transcript_validated_at: '2026-08-15T00:10:00.000Z',
  transcript_json: JSON.stringify({
    segments: [{ speaker: 'Me', text: 'Committed transcript.' }],
  }),
  transcript_integrity_json: '{}',
} as Meeting;

describe('processValidatedMeetingDownstream', () => {
  it('publishes through the coordinator without waiting for secondary work', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GET_MEETING') return validatedMeeting;
      if (channel === 'GENERATE_MEETING_NOTES') {
        return {
          meetingId: validatedMeeting.id,
          runId: 'run-1',
          status: 'published',
        };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      processValidatedMeetingDownstream(validatedMeeting.id, invoke),
    ).resolves.toEqual({ status: 'published' });
    expect(invoke).toHaveBeenCalledWith('GENERATE_MEETING_NOTES', {
      meetingId: validatedMeeting.id,
      requestId: expect.any(String),
      template: 'auto',
      reason: 'automatic',
    });
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_ANALYSIS_V2',
      expect.anything(),
    );
    expect(invoke).not.toHaveBeenCalledWith('SAVE_MEETING', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith(
      'EXTRACT_AND_PROCESS_ENTITIES',
      expect.anything(),
    );
  });

  it('does not request publication for an ineligible transcript', async () => {
    const invoke = vi.fn(async () => ({
      ...validatedMeeting,
      transcript_status: 'needs_attention',
    }));

    await expect(
      processValidatedMeetingDownstream(validatedMeeting.id, invoke),
    ).resolves.toEqual({ status: 'superseded' });
    expect(invoke).not.toHaveBeenCalledWith(
      'GENERATE_MEETING_NOTES',
      expect.anything(),
    );
  });

  it('returns a failed observation when publication rejects', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GET_MEETING') return validatedMeeting;
      if (channel === 'GENERATE_MEETING_NOTES') throw new Error('busy');
      throw new Error(`unexpected channel: ${channel}`);
    });

    await expect(
      processValidatedMeetingDownstream(validatedMeeting.id, invoke),
    ).resolves.toEqual({ status: 'failed' });
  });
});
