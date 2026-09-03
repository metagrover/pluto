import type { Meeting } from '../types.ts';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

type PublishedMeetingNotes = {
  meetingId: string | number;
  runId: string;
  status: 'published';
};

/**
 * Requests notes publication after an already-validated transcript. The main
 * process owns source eligibility, publication, and all secondary processing.
 */
export const processValidatedMeetingDownstream = async (
  meetingId: string | number,
  invoke: Invoke,
  options: { reason?: 'automatic' | 'manual' } = {},
): Promise<{ status: 'published' | 'superseded' | 'failed' }> => {
  const meeting = (await invoke('GET_MEETING', meetingId)) as Meeting | null;
  if (
    !meeting ||
    meeting.transcript_status !== 'validated' ||
    !meeting.transcript_validated_at
  ) {
    return { status: 'superseded' };
  }

  try {
    const result = (await invoke('GENERATE_MEETING_NOTES', {
      meetingId,
      requestId: crypto.randomUUID(),
      template: 'auto',
      reason: options.reason ?? 'automatic',
    })) as PublishedMeetingNotes;
    return result.status === 'published'
      ? { status: 'published' }
      : { status: 'failed' };
  } catch (error) {
    console.error('[Pluto] Notes publication request failed', error);
    return { status: 'failed' };
  }
};
