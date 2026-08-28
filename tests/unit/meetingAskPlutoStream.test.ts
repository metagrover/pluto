import { describe, expect, it } from 'vitest';

import { createMeetingAskPlutoVisibleStream } from '../../electron/intelligence/meetingAskPlutoStream';

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
});
