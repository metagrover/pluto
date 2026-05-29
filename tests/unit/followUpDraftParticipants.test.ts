import { describe, expect, it } from 'vitest';

import { getMeetingParticipants } from '../../src/components/features/followUpDraftParticipants';
import type { Meeting } from '../../src/types';

const makeMeeting = (transcriptJson?: string): Meeting =>
  ({
    id: 'meeting-1',
    title: 'Launch Review',
    created_at: '2026-05-26T17:00:00.000Z',
    started_at: '2026-05-26T17:00:00.000Z',
    transcript_json: transcriptJson,
  }) as Meeting;

describe('getMeetingParticipants', () => {
  it('returns unique transcript speakers in first-seen order', () => {
    const meeting = makeMeeting(
      JSON.stringify({
        segments: [
          { speaker: 'Jordan', text: 'Status update.' },
          { speaker: 'Taylor', text: 'We should ship Friday.' },
          { speaker: 'Jordan', text: 'I will send the recap.' },
          { speaker: ' Taylor ', text: 'I can review the draft.' },
          { speaker: '', text: 'Ambient note.' },
        ],
      }),
    );

    expect(getMeetingParticipants(meeting)).toEqual(['Jordan', 'Taylor']);
  });

  it('falls back safely when transcript data is missing or malformed', () => {
    expect(getMeetingParticipants(makeMeeting())).toEqual([]);
    expect(getMeetingParticipants(makeMeeting('not-json'))).toEqual([]);
  });
});
