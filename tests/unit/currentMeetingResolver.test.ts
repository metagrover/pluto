import { describe, expect, it } from 'vitest';

import {
  queryReferencesCurrentMeeting,
  resolveCurrentMeeting,
  resolvePersistedMeetingEvidenceState,
} from '../../electron/intelligence/currentMeetingResolver';

describe('resolveCurrentMeeting', () => {
  it('prefers the active recording over persisted meetings', () => {
    expect(
      resolveCurrentMeeting({
        activeRecordingMeetingId: 'live-3',
        meetings: [
          {
            id: 'saved-4',
            started_at: '2026-08-25T20:00:00.000Z',
            created_at: '2026-08-25T20:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'active_recording', meetingId: 'live-3' });
  });

  it('uses the most recently started persisted meeting without requiring completion', () => {
    expect(
      resolveCurrentMeeting({
        activeRecordingMeetingId: null,
        meetings: [
          {
            id: 'completed',
            started_at: '2026-08-25T18:00:00.000Z',
            created_at: '2026-08-25T18:00:00.000Z',
          },
          {
            id: 'processing',
            started_at: '2026-08-25T21:00:00.000Z',
            created_at: '2026-08-25T21:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'persisted', meetingId: 'processing' });
  });

  it('falls back to created time and returns none when there are no meetings', () => {
    expect(
      resolveCurrentMeeting({
        activeRecordingMeetingId: null,
        meetings: [
          {
            id: 'older',
            started_at: null,
            created_at: '2026-08-25T18:00:00.000Z',
          },
          {
            id: 'newer',
            started_at: null,
            created_at: '2026-08-25T19:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'persisted', meetingId: 'newer' });
    expect(
      resolveCurrentMeeting({
        activeRecordingMeetingId: null,
        meetings: [],
      }),
    ).toEqual({ kind: 'none', meetingId: null });
  });

  it('recognizes explicit current-meeting language without treating every query as scoped', () => {
    expect(queryReferencesCurrentMeeting('Summarize the current meeting')).toBe(
      true,
    );
    expect(
      queryReferencesCurrentMeeting('Compare this meeting with the latest one'),
    ).toBe(true);
    expect(queryReferencesCurrentMeeting('What did Riley decide?')).toBe(false);
  });
});

describe('resolvePersistedMeetingEvidenceState', () => {
  it('keeps downstream processing and failure distinct from completed evidence', () => {
    expect(
      resolvePersistedMeetingEvidenceState({
        finalizationStatus: 'finalized',
        downstreamProcessingJson: JSON.stringify({ state: 'processing' }),
      }),
    ).toBe('processing');
    expect(
      resolvePersistedMeetingEvidenceState({
        finalizationStatus: 'finalized',
        downstreamProcessingJson: JSON.stringify({ state: 'failed' }),
      }),
    ).toBe('failed');
    expect(
      resolvePersistedMeetingEvidenceState({
        finalizationStatus: 'recovery_required',
        downstreamProcessingJson: JSON.stringify({ state: 'complete' }),
      }),
    ).toBe('failed');
    expect(
      resolvePersistedMeetingEvidenceState({
        finalizationStatus: 'finalized',
        downstreamProcessingJson: JSON.stringify({ state: 'complete' }),
      }),
    ).toBe('completed');
  });
});
