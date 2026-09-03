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
  it('omits a reconciled echo without mutating its evidence', () => {
    const echo = {
      ...segment('mic-echo', 'Me', 'The duplicated microphone row.', 1_000),
      source: 'mic' as const,
      presentation: {
        visibility: 'suppressed_echo' as const,
        matchedSegmentId: 'system-1',
        confidence: 0.95,
        reason: 'cross_channel_echo' as const,
      },
    };
    const call = {
      ...segment('system-1', 'Them', 'The remote row remains.', 1_050),
      source: 'system' as const,
    };

    expect(buildLiveTranscriptTurns([echo, call])).toHaveLength(1);
    expect(buildLiveTranscriptTurns([echo, call])[0].segments).toEqual([call]);
    expect(echo.presentation.visibility).toBe('suppressed_echo');
  });

  it('groups consecutive same-speaker segments without changing their evidence', () => {
    const first = segment('one', 'Me', 'This sentence', 1_000);
    const second = segment('two', 'Me', 'continues here.', 2_000);

    expect(buildLiveTranscriptTurns([first, second])).toEqual([
      {
        id: 'one',
        speaker: 'Me',
        source: undefined,
        timestampMs: 1_000,
        segments: [first, second],
        paragraphs: [
          {
            id: 'one:part:0',
            parts: [
              {
                id: 'one:part:0',
                text: 'This sentence',
                confirmed: true,
              },
              {
                id: 'two:part:0',
                text: 'continues here.',
                confirmed: true,
              },
            ],
          },
        ],
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

  it('bounds a long same-speaker run without changing its segments', () => {
    const longSegments = Array.from({ length: 12 }, (_, index) =>
      segment(
        `segment-${index}`,
        'Them',
        `Sentence ${index} contains enough words to make a sustained monologue readable.`,
        index * 5_000,
      ),
    );

    const turns = buildLiveTranscriptTurns(longSegments);

    expect(turns.length).toBeGreaterThan(1);
    expect(turns.flatMap((turn) => turn.segments)).toEqual(longSegments);
    expect(
      turns.every(
        (turn) =>
          turn.segments.map((item) => item.text).join(' ').length <= 420,
      ),
    ).toBe(true);
  });

  it('splits one oversized source segment into readable presentation paragraphs', () => {
    const original = segment(
      'monologue',
      'Them',
      Array.from(
        { length: 14 },
        (_, index) => `Sentence ${index} explains one bounded idea clearly.`,
      ).join(' '),
      1_000,
    );

    const [turn] = buildLiveTranscriptTurns([original]);

    expect(turn.segments).toEqual([original]);
    expect(turn.paragraphs.length).toBeGreaterThan(1);
    expect(
      turn.paragraphs.every(
        (paragraph) =>
          paragraph.parts.map((part) => part.text).join(' ').length <= 320,
      ),
    ).toBe(true);
    expect(original.text).toContain('Sentence 13');
  });
});
