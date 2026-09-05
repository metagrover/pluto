import { describe, expect, it } from 'vitest';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
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
  ])('rejects %s as a generic person label', (label) => {
    expect(isGenericSpeakerLabel(label)).toBe(true);
  });

  it('does not reject a real person whose name contains speaker words', () => {
    expect(isGenericSpeakerLabel('Speaker Johnson')).toBe(false);
    expect(isGenericSpeakerLabel('Alex Voice')).toBe(false);
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
});
