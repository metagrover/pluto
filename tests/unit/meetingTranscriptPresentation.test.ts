import { describe, expect, it } from 'vitest';
import { buildMeetingTranscriptTurns } from '../../src/components/features/meetingTranscriptPresentation';
import type { TranscriptSegment } from '../../src/types';

describe('meeting transcript presentation', () => {
  it('bounds long same-speaker reading turns without changing evidence rows', () => {
    const segments: TranscriptSegment[] = Array.from(
      { length: 14 },
      (_, index) => ({
        speaker: 'Them',
        startTime: index * 5,
        endTime: index * 5 + 4,
        text: `Sentence ${index} retains its canonical wording and punctuation.`,
      }),
    );

    const turns = buildMeetingTranscriptTurns(segments);

    expect(turns.length).toBeGreaterThan(1);
    expect(turns.flatMap((turn) => turn.segments)).toEqual(segments);
    expect(
      turns.every(
        (turn) =>
          turn.segments.map((segment) => segment.text).join(' ').length <= 420,
      ),
    ).toBe(true);
  });

  it('starts a new reading turn when the speaker changes', () => {
    const turns = buildMeetingTranscriptTurns([
      { speaker: 'Me', startTime: 0, endTime: 2, text: 'My point.' },
      { speaker: 'Them', startTime: 2, endTime: 4, text: 'Their answer.' },
    ]);

    expect(turns.map((turn) => turn.speaker)).toEqual(['Me', 'Them']);
  });
});
