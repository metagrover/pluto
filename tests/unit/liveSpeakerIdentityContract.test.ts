import { describe, expect, it } from 'vitest';
import {
  liveSpeakerHintForRange,
  parseLiveSpeakerIdentitySnapshot,
} from '../../src/services/liveTranscription/liveSpeakerIdentityContract';

describe('live speaker identity renderer contract', () => {
  const snapshot = {
    meetingId: 'meeting-1',
    generation: 1,
    revision: 3,
    hints: [
      {
        suggestionId: 'hint-1',
        displayLabel: 'Likely Alex',
        state: 'suggested' as const,
        generation: 1,
        revision: 3,
        ranges: [{ startMs: 1_000, endMs: 4_000 }],
      },
    ],
  };

  it('accepts the sanitized bounded envelope and decorates only fully covered speech', () => {
    const parsed = parseLiveSpeakerIdentitySnapshot(snapshot);
    expect(parsed).toEqual(snapshot);
    expect(liveSpeakerHintForRange(parsed, 1_500, 3_500)?.displayLabel).toBe(
      'Likely Alex',
    );
    expect(liveSpeakerHintForRange(parsed, 500, 3_500)).toBeNull();
  });

  it('rejects biometric and model internals at the renderer boundary', () => {
    expect(
      parseLiveSpeakerIdentitySnapshot({
        ...snapshot,
        hints: [{ ...snapshot.hints[0], embedding: [1, 2, 3] }],
      }),
    ).toBeNull();
  });

  it('retains rejected coverage for reversible UI while hiding revoked suggestions', () => {
    const rejected = parseLiveSpeakerIdentitySnapshot({
      ...snapshot,
      hints: [{ ...snapshot.hints[0], state: 'rejected' }],
    });
    expect(liveSpeakerHintForRange(rejected, 1_500, 3_500)?.state).toBe(
      'rejected',
    );

    const revoked = parseLiveSpeakerIdentitySnapshot({
      ...snapshot,
      hints: [{ ...snapshot.hints[0], state: 'revoked' }],
    });
    expect(liveSpeakerHintForRange(revoked, 1_500, 3_500)).toBeNull();
  });
});
