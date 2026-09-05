import { describe, expect, it } from 'vitest';
import {
  applyMeetingSpeakerDisplayNames,
  buildMeetingTranscriptTurns,
} from '../../src/components/features/meetingTranscriptPresentation';
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

  it('projects confirmed names across matching turns without mutating evidence rows', () => {
    const segments: TranscriptSegment[] = [
      {
        speaker: 'Remote Speaker 1',
        startTime: 0,
        endTime: 2,
        text: 'First point.',
      },
      {
        speaker: 'Remote Speaker 2',
        startTime: 2,
        endTime: 4,
        text: 'Second point.',
      },
      {
        speaker: 'Remote Speaker 1',
        startTime: 4,
        endTime: 6,
        text: 'Third point.',
      },
    ];

    const projected = applyMeetingSpeakerDisplayNames(segments, {
      'Remote Speaker 1': 'Avery Chen',
    });

    expect(projected.map((segment) => segment.speaker)).toEqual([
      'Avery Chen',
      'Speaker 2',
      'Avery Chen',
    ]);
    expect(segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
      'Remote Speaker 1',
    ]);
  });
});
