import { describe, expect, it } from 'vitest';

import { buildReadableTranscriptSegments } from '../../src/utils/readableTranscript.ts';

describe('buildReadableTranscriptSegments', () => {
  it('hides short Me bleed fragments embedded in a longer Them utterance', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 1,
        endTime: 6,
        text: 'These are the entry points we are going to be running.',
      },
      { speaker: 'Me', startTime: 2, endTime: 2.3, text: 'kinda' },
      {
        speaker: 'Me',
        startTime: 3,
        endTime: 4,
        text: 'run uh running uh',
      },
    ]);

    expect(result.segments.map((segment) => segment.text)).toEqual([
      'These are the entry points we are going to be running.',
    ]);
    expect(result.stats.embeddedFragmentCount).toBe(2);
  });

  it('keeps a local turn that continues beyond the remote utterance', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 1,
        endTime: 4,
        text: 'This should fit in as written.',
      },
      {
        speaker: 'Me',
        startTime: 3.5,
        endTime: 6,
        text: 'Do these match the original format?',
      },
    ]);

    expect(result.segments).toHaveLength(2);
    expect(result.stats.embeddedFragmentCount).toBe(0);
  });
});
