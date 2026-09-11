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
  it('uses capture source for stable roles without changing live-edge order', () => {
    const remote = {
      ...segment('remote', 'Me', 'Remote words.', 2_000),
      source: 'system' as const,
    };
    const local = {
      ...segment('local', 'Them', 'Local words.', 1_000),
      source: 'mic' as const,
    };

    const turns = buildLiveTranscriptTurns([remote, local]);

    expect(turns.map((turn) => [turn.speaker, turn.timestampMs])).toEqual([
      ['Them', 2_000],
      ['Me', 1_000],
    ]);
    expect(remote.speaker).toBe('Me');
    expect(local.speaker).toBe('Them');
  });

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

  it('orders the retained local suffix by its presentation time without changing raw evidence', () => {
    const raw = {
      ...segment('mic', 'Me', 'remote words local answer', 31_920),
      source: 'mic' as const,
      endTimestampMs: 44_800,
      presentation: {
        visibility: 'echo_span_removed' as const,
        text: 'local answer',
        timestampMs: 43_520,
        endTimestampMs: 44_800,
        matchedSegmentId: 'system',
        confidence: 1,
        reason: 'cross_channel_echo' as const,
      },
    };
    const call = {
      ...segment('system', 'Them', 'remote words', 32_000),
      source: 'system' as const,
    };
    const tail = {
      ...segment('tail', 'Me', 'perfect', 44_800),
      source: 'mic' as const,
      confirmed: false,
    };
    const before = structuredClone(raw);
    const turns = buildLiveTranscriptTurns([raw, call, tail]);
    expect(turns.map((turn) => turn.source)).toEqual(['system', 'mic']);
    expect(turns[1].timestampMs).toBe(43_520);
    expect(turns[1].segments.map((row) => row.text)).toEqual([
      'local answer',
      'perfect',
    ]);
    expect(raw).toEqual(before);
    const { presentation: _presentation, ...restored } = raw;
    expect(
      buildLiveTranscriptTurns([restored, call, tail])[0].timestampMs,
    ).toBe(31_920);
  });

  it('keeps legacy partial-removal timing and stable order for equal start times', () => {
    const first = {
      ...segment('one', 'Me', 'raw first', 1000),
      presentation: {
        visibility: 'echo_span_removed' as const,
        text: 'first',
        matchedSegmentId: 'system',
        confidence: 1,
        reason: 'cross_channel_echo' as const,
      },
    };
    const second = segment('two', 'Them', 'second', 1000);
    const turns = buildLiveTranscriptTurns([first, second]);
    expect(turns.map((turn) => turn.id)).toEqual(['one', 'two']);
    expect(turns[0].timestampMs).toBe(1000);
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
