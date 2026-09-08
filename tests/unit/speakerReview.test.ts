import { describe, expect, it } from 'vitest';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
  selectReviewableAnonymousSpeakers,
  selectSpeakerEnrollmentIntervals,
  selectSpeakerSampleIntervals,
} from '../../src/utils/speakerReview';

describe('speaker review', () => {
  it('projects canonical remote labels without changing unrelated speakers', () => {
    expect(getAnonymousSpeakerDisplayLabel('Remote Speaker 2')).toBe(
      'Speaker 2',
    );
    expect(getAnonymousSpeakerDisplayLabel('Me')).toBe('Me');
    expect(getAnonymousSpeakerDisplayLabel('Avery Chen')).toBe('Avery Chen');
  });

  it.each([
    'Speaker',
    'Speaker 2',
    'Remote Speaker 12',
    'Local Speaker 3',
    'Participant 1',
    'Voice 4',
    'Unknown speaker',
    'Unidentified speaker 2',
    'Me',
    'Them',
    'You',
    'Unknown',
  ])('rejects %s as a generic person label', (label) => {
    expect(isGenericSpeakerLabel(label)).toBe(true);
  });

  it('does not reject a real person whose name contains speaker words', () => {
    expect(isGenericSpeakerLabel('Speaker Johnson')).toBe(false);
    expect(isGenericSpeakerLabel('Alex Voice')).toBe(false);
  });

  it('prefers numbered remote speakers over the aggregate Them label', () => {
    expect(
      selectReviewableAnonymousSpeakers([
        'Me',
        'Them',
        'Remote Speaker 2',
        'Remote Speaker 2',
        'Remote Speaker 1',
      ]),
    ).toEqual(['Remote Speaker 2', 'Remote Speaker 1']);
  });

  it('reviews Them only when no numbered remote speaker is available', () => {
    expect(
      selectReviewableAnonymousSpeakers(['Me', 'Them', 'Unknown']),
    ).toEqual(['Them']);
    expect(
      selectReviewableAnonymousSpeakers(['Me', 'Unknown', 'Local Speaker 1']),
    ).toEqual([]);
  });

  it('selects clean, bounded, deterministic samples and excludes overlap', () => {
    const intervals = selectSpeakerSampleIntervals(
      [
        {
          speaker: 'Remote Speaker 1',
          start: 10,
          end: 13,
          text: 'I will send',
        },
        {
          speaker: 'Remote Speaker 1',
          start: 13.3,
          end: 17,
          text: 'the revised proposal tomorrow.',
        },
        {
          speaker: 'Remote Speaker 2',
          start: 22,
          end: 24,
          text: 'Overlapping reply.',
        },
        {
          speaker: 'Remote Speaker 1',
          start: 21,
          end: 25,
          text: 'This candidate overlaps another speaker.',
        },
        {
          speaker: 'Remote Speaker 1',
          start: 30,
          end: 36,
          text: 'A second clean representative sample.',
        },
      ],
      'Remote Speaker 1',
    );

    expect(intervals).toEqual([
      {
        startSec: 10,
        endSec: 17,
        excerpt: 'I will send the revised proposal tomorrow.',
      },
      {
        startSec: 30,
        endSec: 36,
        excerpt: 'A second clean representative sample.',
      },
    ]);
  });

  it('keeps a two-second clean fallback and caps long samples at eight seconds', () => {
    expect(
      selectSpeakerSampleIntervals(
        [
          {
            speaker: 'Remote Speaker 1',
            startTime: 4,
            endTime: 6,
            text: 'Short but usable.',
          },
          {
            speaker: 'Remote Speaker 1',
            startTime: 20,
            endTime: 32,
            text: 'Long clean answer.',
          },
        ],
        'Remote Speaker 1',
      ),
    ).toEqual([
      {
        startSec: 20,
        endSec: 28,
        excerpt: 'Long clean answer.',
      },
      {
        startSec: 4,
        endSec: 6,
        excerpt: 'Short but usable.',
      },
    ]);
  });

  it('selects a clean sample for the aggregate Them speaker', () => {
    expect(
      selectSpeakerSampleIntervals(
        [
          {
            speaker: 'Them',
            start: 3,
            end: 7,
            text: 'Aggregate remote sample.',
          },
        ],
        'Them',
      ),
    ).toEqual([
      {
        startSec: 3,
        endSec: 7,
        excerpt: 'Aggregate remote sample.',
      },
    ]);
  });

  it('selects richer enrollment evidence without changing the two-sample review cap', () => {
    const segments = Array.from({ length: 10 }, (_, index) => ({
      speaker: 'Remote Speaker 1',
      start: index * 12,
      end: index * 12 + 8,
      text: `Clean answer ${index + 1}.`,
    }));

    expect(
      selectSpeakerSampleIntervals(segments, 'Remote Speaker 1', 12),
    ).toHaveLength(2);
    const enrollment = selectSpeakerEnrollmentIntervals(
      segments,
      'Remote Speaker 1',
    );
    expect(enrollment).toHaveLength(10);
    expect(
      enrollment.reduce(
        (total, interval) => total + interval.endSec - interval.startSec,
        0,
      ),
    ).toBe(60);
    expect(enrollment.map((interval) => interval.startSec)).toEqual([
      0, 12, 24, 36, 48, 60, 72, 84, 96, 108,
    ]);
  });

  it('keeps overlap out of enrollment evidence and requires two clean intervals', () => {
    const segments = [
      { speaker: 'Them', start: 0, end: 5, text: 'First clean answer.' },
      { speaker: 'Them', start: 10, end: 16, text: 'Overlapped answer.' },
      { speaker: 'Me', start: 12, end: 13, text: 'Interruption.' },
      { speaker: 'Them', start: 20, end: 24, text: 'Second clean answer.' },
    ];

    expect(selectSpeakerEnrollmentIntervals(segments, 'Them')).toEqual([
      { startSec: 0, endSec: 5, excerpt: 'First clean answer.' },
      { startSec: 20, endSec: 24, excerpt: 'Second clean answer.' },
    ]);
  });

  it.each([
    'Them',
    'Remote Speaker 2',
    'Unknown',
    'Unidentified speaker',
    'Guest A',
    '',
    'Local Speaker 1',
  ])(
    'keeps overlapping %s speech out of numbered remote samples',
    (otherSpeaker) => {
      const segments = [
        {
          speaker: 'Remote Speaker 1',
          start: 0,
          end: 5,
          text: 'Overlapped answer.',
        },
        {
          speaker: otherSpeaker,
          start: 1,
          end: 3,
          text: 'Unresolved or other voice.',
        },
      ];
      expect(
        selectSpeakerSampleIntervals(segments, 'Remote Speaker 1'),
      ).toEqual([]);
      expect(
        selectSpeakerEnrollmentIntervals(segments, 'Remote Speaker 1'),
      ).toEqual([]);
    },
  );

  it.each(['Them', 'Remote Speaker 2', 'Unknown'])(
    'does not join clean remote segments across a short %s interruption',
    (otherSpeaker) => {
      const segments = [
        {
          speaker: 'Remote Speaker 1',
          start: 0,
          end: 3,
          text: 'First answer.',
        },
        {
          speaker: otherSpeaker,
          start: 3,
          end: 3.5,
          text: 'Brief interruption.',
        },
        {
          speaker: 'Remote Speaker 1',
          start: 3.5,
          end: 7,
          text: 'Second answer.',
        },
      ];
      expect(
        selectSpeakerEnrollmentIntervals(segments, 'Remote Speaker 1'),
      ).toEqual([
        { startSec: 0, endSec: 3, excerpt: 'First answer.' },
        { startSec: 3.5, endSec: 7, excerpt: 'Second answer.' },
      ]);
      expect(
        selectSpeakerSampleIntervals(segments, 'Remote Speaker 1'),
      ).toHaveLength(2);
    },
  );

  it('retains the full extent of nested same-speaker segments', () => {
    expect(
      selectSpeakerEnrollmentIntervals(
        [
          {
            speaker: 'Remote Speaker 1',
            start: 0,
            end: 7,
            text: 'Long answer.',
          },
          {
            speaker: 'Remote Speaker 1',
            start: 1,
            end: 2,
            text: 'Nested segment.',
          },
        ],
        'Remote Speaker 1',
      ),
    ).toEqual([
      { startSec: 0, endSec: 7, excerpt: 'Long answer. Nested segment.' },
    ]);
  });

  it('does not treat overlapping local mic speech as contamination of numbered remote system audio', () => {
    const segments = [
      {
        speaker: 'Remote Speaker 1',
        start: 0,
        end: 5,
        text: 'First remote answer.',
      },
      { speaker: 'Me', start: 1, end: 3, text: 'Local interruption.' },
      {
        speaker: 'Remote Speaker 1',
        start: 10,
        end: 15,
        text: 'Second remote answer.',
      },
      { speaker: 'Me', start: 11, end: 13, text: 'Another interruption.' },
      {
        speaker: 'Remote Speaker 1',
        start: 20,
        end: 25,
        text: 'Contaminated remote answer.',
      },
      {
        speaker: 'Remote Speaker 2',
        start: 22,
        end: 24,
        text: 'Other remote speaker.',
      },
    ];

    expect(
      selectSpeakerEnrollmentIntervals(segments, 'Remote Speaker 1'),
    ).toEqual([
      { startSec: 0, endSec: 5, excerpt: 'First remote answer.' },
      { startSec: 10, endSec: 15, excerpt: 'Second remote answer.' },
    ]);
  });
});
