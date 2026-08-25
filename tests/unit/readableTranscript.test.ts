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
    expect(
      result.stats.embeddedFragmentCount + result.stats.crossChannelEchoCount,
    ).toBe(2);
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

  it('hides a matching mic echo while retaining the authoritative system row', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'The rollout is ready for the next review.',
      },
      {
        speaker: 'Me',
        startTime: 10.2,
        endTime: 13.8,
        text: 'the rollout is ready for next review',
      },
    ]);

    expect(result.segments.map((segment) => segment.speaker)).toEqual(['Them']);
    expect(result.segments.map((segment) => segment.text)).toEqual([
      'The rollout is ready for the next review.',
    ]);
    expect(result.stats.crossChannelEchoCount).toBe(1);
  });

  it('keeps different mic speech during genuine cross-channel overlap', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 20,
        endTime: 24,
        text: 'I can walk through the implementation details.',
      },
      {
        speaker: 'Me',
        startTime: 21,
        endTime: 23,
        text: 'Sorry, can I ask a quick question?',
      },
    ]);

    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Me',
    ]);
    expect(result.stats.crossChannelEchoCount).toBe(0);
  });

  it('matches mic echo against remote speech split across adjacent rows', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 30,
        endTime: 32,
        text: 'alpha beta gamma',
      },
      {
        speaker: 'Them',
        startTime: 32,
        endTime: 34,
        text: 'delta epsilon zeta',
      },
      {
        speaker: 'Them',
        startTime: 34,
        endTime: 36,
        text: 'eta theta iota',
      },
      {
        speaker: 'Me',
        startTime: 30,
        endTime: 36,
        text: 'gamma alpha beta zeta delta epsilon iota eta theta',
      },
    ]);

    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Them',
      'Them',
    ]);
  });

  it.each([
    {
      micText: 'age then',
      remoteText: 'Okay, switch the task to Aish then.',
    },
    {
      micText: 'viewers for',
      remoteText: 'The query created the view for the cohort.',
    },
  ])(
    'suppresses time-contained phonetic mic echo: $micText',
    ({ micText, remoteText }) => {
      const result = buildReadableTranscriptSegments([
        {
          speaker: 'Them',
          startTime: 40,
          endTime: 45,
          text: remoteText,
        },
        { speaker: 'Me', startTime: 41, endTime: 44.9, text: micText },
      ]);

      expect(result.segments.map((segment) => segment.text)).toEqual([
        remoteText,
      ]);
      expect(result.stats.crossChannelEchoCount).toBe(1);
    },
  );

  it('keeps a phonetic-looking overlap when validated near-end evidence exists', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 50,
        endTime: 55,
        text: 'Okay, switch the task to Aish then.',
      },
      {
        speaker: 'Me',
        startTime: 51,
        endTime: 54.9,
        text: 'age then',
        nearEndEvidence: true,
      },
    ]);

    expect(result.segments).toHaveLength(2);
  });

  it('keeps genuine short double-talk with no phonetic agreement', () => {
    const result = buildReadableTranscriptSegments([
      {
        speaker: 'Them',
        startTime: 60,
        endTime: 64,
        text: 'I can walk through the implementation details.',
      },
      {
        speaker: 'Me',
        startTime: 60.5,
        endTime: 63.8,
        text: 'quick question',
      },
    ]);

    expect(result.segments).toHaveLength(2);
  });
});
