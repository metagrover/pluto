import { describe, expect, it } from 'vitest';

import {
  beginRetryLease,
  buildRetryDeadline,
  finishRetryLease,
  mergeTranscriptOwnedFields,
  readRetryLease,
} from '../../src/services/transcriptValidationRetryLease';

const prior = {
  reasons: ['remote_speech_unaccounted'],
  micActivitySeconds: 12,
  activityEvidence: { schemaVersion: 1, windows: [] },
};

describe('transcriptValidationRetryLease', () => {
  it('preserves complete integrity evidence while adding a retry lease', () => {
    const integrity = beginRetryLease(prior, {
      runId: 'run-1',
      startedAt: '2026-07-21T20:00:00.000Z',
      deadlineAt: '2026-07-21T20:10:00.000Z',
      stage: 'transcribing',
    });

    expect(integrity).toMatchObject(prior);
    expect(readRetryLease(integrity)).toMatchObject({
      runId: 'run-1',
      stage: 'transcribing',
    });
  });

  it('uses a ten-minute floor and scales to twice the recording duration', () => {
    const now = Date.parse('2026-07-21T20:00:00.000Z');
    expect(buildRetryDeadline(now, 60)).toBe(now + 10 * 60_000);
    expect(buildRetryDeadline(now, 3600)).toBe(now + 2 * 3600_000);
  });

  it('removes the lease and records a content-free terminal failure', () => {
    const active = beginRetryLease(prior, {
      runId: 'run-1',
      startedAt: '2026-07-21T20:00:00.000Z',
      deadlineAt: '2026-07-21T20:10:00.000Z',
      stage: 'transcribing',
    });
    const finished = finishRetryLease(active, 'retry_timeout');

    expect(readRetryLease(finished)).toBeNull();
    expect(finished).toMatchObject({
      reasons: ['remote_speech_unaccounted'],
      retryFailure: 'retry_timeout',
    });
  });

  it('merges transcript-owned fields without overwriting concurrent user edits', () => {
    const merged = mergeTranscriptOwnedFields(
      { title: 'User title', user_notes: 'User notes', is_favorite: true },
      {
        title: 'Stale title',
        user_notes: 'Stale notes',
        transcript_status: 'validated',
        transcript_json: '{"segments":[]}',
      },
    );

    expect(merged).toMatchObject({
      title: 'User title',
      user_notes: 'User notes',
      is_favorite: true,
      transcript_status: 'validated',
      transcript_json: '{"segments":[]}',
    });
  });
});
