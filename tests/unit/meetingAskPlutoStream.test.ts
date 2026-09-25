import { describe, expect, it } from 'vitest';
import {
  createMeetingAskPlutoVisibleStream,
  stripMeetingAskPlutoTimestampNarration,
} from '../../electron/intelligence/meetingAskPlutoStream';



const streamChunks = (chunks: string[], flush = true) => {
  const visible: string[] = [];
  const stream = createMeetingAskPlutoVisibleStream((delta) =>
    visible.push(delta),
  );
  for (const chunk of chunks) stream.push(chunk);
  if (flush) stream.flush();
  return visible.join('');
};

describe('meeting Ask Pluto visible stream', () => {
  it('emits ordinary provider chunks in order', () => {
    expect(streamChunks(['The person ', 'is Isha.'])).toBe(
      'The person is Isha.',
    );
  });

  it('removes a meeting-evidence preamble split at every chunk boundary', () => {
    const answer =
      'Based on the meeting evidence provided, the main issue was pricing.';
    for (let index = 1; index < answer.length; index += 1) {
      expect(streamChunks([answer.slice(0, index), answer.slice(index)])).toBe(
        'The main issue was pricing.',
      );
    }
  });

  it('does not remove a substantive opening that happens to start with based on', () => {
    expect(streamChunks(['Based on pricing, the launch date changed.'])).toBe(
      'Based on pricing, the launch date changed.',
    );
  });

  it('removes complete internal evidence references', () => {
    expect(streamChunks(['Isha [Evidence 2] owns the review.'])).toBe(
      'Isha  owns the review.',
    );
  });

  it('removes evidence references split at every chunk boundary', () => {
    const answer = 'Isha [Evidence 12] owns the review.';
    for (let index = 1; index < answer.length; index += 1) {
      expect(streamChunks([answer.slice(0, index), answer.slice(index)])).toBe(
        'Isha  owns the review.',
      );
    }
  });

  it('preserves brackets that are not evidence references', () => {
    expect(streamChunks(['Use [draft] and ', '[Evidence-based notes].'])).toBe(
      'Use [draft] and [Evidence-based notes].',
    );
  });

  it('does not expose an unfinished evidence reference on flush', () => {
    expect(streamChunks(['Isha [Evidence 2'])).toBe('Isha ');
  });

  it('strips awkward raw timestamp narration clauses from prose', () => {
    expect(
      stripMeetingAskPlutoTimestampNarration(
        'A decision to continue writing despite some issues, as mentioned by the speaker at 58 seconds.',
      ),
    ).toBe('A decision to continue writing despite some issues.');

    expect(
      stripMeetingAskPlutoTimestampNarration(
        'The importance of a client that was highlighted in the last meeting, as indicated at 361 seconds.',
      ),
    ).toBe('The importance of a client that was highlighted in the last meeting.');

    expect(
      stripMeetingAskPlutoTimestampNarration(
        'A question about whether an IPO is one of the biggest things the team will do, asked at 860 seconds.',
      ),
    ).toBe('A question about whether an IPO is one of the biggest things the team will do.');

    expect(
      stripMeetingAskPlutoTimestampNarration(
        'The possibility of trimming information, as discussed at 1029 seconds.',
      ),
    ).toBe('The possibility of trimming information.');

    expect(
      stripMeetingAskPlutoTimestampNarration(
        'A discussion about the planning process, which the speaker at 795 seconds suggests might be too late.',
      ),
    ).toBe('A discussion about the planning process, which might be too late.');

    expect(
      stripMeetingAskPlutoTimestampNarration('as mentioned on 110 seconds.'),
    ).toBe('');
  });

  it('preserves substantive numbers and durations that are not timestamp narration', () => {
    expect(
      stripMeetingAskPlutoTimestampNarration(
        'The timeout increased by 110 seconds.',
      ),
    ).toBe('The timeout increased by 110 seconds.');

    expect(
      stripMeetingAskPlutoTimestampNarration(
        'Revenue grew by 25 percent this quarter.',
      ),
    ).toBe('Revenue grew by 25 percent this quarter.');
  });
});

