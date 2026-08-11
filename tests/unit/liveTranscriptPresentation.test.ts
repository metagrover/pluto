import { describe, expect, it } from 'vitest';

import { buildLiveTranscriptTurns } from '../../src/components/features/liveTranscriptPresentation';

const segment = (
  id: string,
  speaker: 'Me' | 'Them',
  text: string,
  timestampMs: number,
) => ({
  id,
  speaker,
  text,
  timestampMs,
  confirmed: true,
});

describe('live transcript presentation', () => {
  it('groups consecutive same-speaker segments without changing their evidence', () => {
    const first = segment('one', 'Me', 'This sentence', 1_000);
    const second = segment('two', 'Me', 'continues here.', 2_000);

    expect(buildLiveTranscriptTurns([first, second])).toEqual([
      {
        id: 'one',
        speaker: 'Me',
        timestampMs: 1_000,
        segments: [first, second],
      },
    ]);
    expect(first.text).toBe('This sentence');
    expect(second.text).toBe('continues here.');
  });

  it('starts a new presentation turn when the speaker changes', () => {
    const turns = buildLiveTranscriptTurns([
      segment('one', 'Me', 'My turn.', 1_000),
      segment('two', 'Them', 'Their turn.', 2_000),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.speaker)).toEqual(['Me', 'Them']);
  });
});
