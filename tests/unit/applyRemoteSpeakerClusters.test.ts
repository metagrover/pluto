import { describe, expect, it } from 'vitest';

import { applyRemoteSpeakerClusters } from '../../src/services/finalTranscription/applyRemoteSpeakerClusters';

const words = (items: Array<[string, number, number]>) =>
  items.map(([word, start, end]) => ({ word, start, end }));

describe('applyRemoteSpeakerClusters', () => {
  it('numbers supported system clusters by first appearance and splits on word bounds', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'hello there yes agreed',
          words: words([
            ['hello', 0, 0.8],
            ['there', 0.8, 1.8],
            ['yes', 2.1, 2.8],
            ['agreed', 2.8, 4],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 1.9, cluster: 'z-cluster' },
        { startTime: 2, endTime: 4, cluster: 'a-cluster' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
    expect(result.segments.map((segment) => segment.text)).toEqual([
      'hello there',
      'yes agreed',
    ]);
    expect(result.metadata).toMatchObject({
      attempted: true,
      input: 'system_audio',
      applied: true,
      confidence: 1,
      clusterCount: 2,
      labeledSegmentCount: 2,
    });
  });

  it('never relabels Me or Unknown segments, including simultaneous speech', () => {
    const input = [
      { startTime: 0, endTime: 2, speaker: 'Me', text: 'local' },
      { startTime: 2, endTime: 4, speaker: 'Unknown', text: 'overlap' },
      { startTime: 4, endTime: 6, speaker: 'Them', text: 'remote one' },
      { startTime: 6, endTime: 8, speaker: 'Them', text: 'remote two' },
    ];
    const result = applyRemoteSpeakerClusters({
      segments: input,
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S3' },
        { startTime: 2, endTime: 4, cluster: 'S2' },
        { startTime: 4, endTime: 6, cluster: 'S1' },
        { startTime: 6, endTime: 8, cluster: 'S2' },
      ],
    });

    expect(result.segments[0].speaker).toBe('Me');
    expect(result.segments[1].speaker).toBe('Unknown');
    expect(result.segments.slice(2).map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('suppresses a sub-second phantom cluster instead of creating another speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'first speaker' },
        { startTime: 2, endTime: 2.5, speaker: 'Them', text: 'yeah' },
        { startTime: 2.5, endTime: 5, speaker: 'Them', text: 'second speaker' },
      ],
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S1' },
        { startTime: 2, endTime: 2.5, cluster: 'phantom' },
        { startTime: 2.5, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.clusterCount).toBe(2);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('smooths a sub-second phantom between established turns from the same speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 2, speaker: 'Them', text: 'opening' },
        { startTime: 2, endTime: 2.5, speaker: 'Them', text: 'yeah' },
        { startTime: 2.5, endTime: 4, speaker: 'Them', text: 'continuing' },
        { startTime: 4, endTime: 6, speaker: 'Them', text: 'reply' },
      ],
      turns: [
        { startTime: 0, endTime: 2, cluster: 'S1' },
        { startTime: 2, endTime: 2.5, cluster: 'phantom' },
        { startTime: 2.5, endTime: 4, cluster: 'S1' },
        { startTime: 4, endTime: 6, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 1',
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('keeps a genuinely overlapping remote word anonymous', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 5,
          speaker: 'Them',
          text: 'one two overlap three four',
          words: words([
            ['one', 0, 1],
            ['two', 1, 2],
            ['overlap', 2, 3],
            ['three', 3, 4],
            ['four', 4, 5],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 3, cluster: 'S1' },
        { startTime: 2, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('keeps an unequally overlapped remote word anonymous', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 5,
          speaker: 'Them',
          text: 'one two overlap three four',
          words: words([
            ['one', 0, 1],
            ['two', 1, 2],
            ['overlap', 2, 3],
            ['three', 3, 4],
            ['four', 4, 5],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 3, cluster: 'S1' },
        { startTime: 2.4, endTime: 5, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Remote Speaker 1',
      'Them',
      'Remote Speaker 2',
    ]);
  });

  it('preserves standalone punctuation while splitting word groups', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Them',
          text: 'Hello, world. Yes!',
          words: words([
            ['Hello', 0, 0.8],
            [',', 0.8, 0.8],
            ['world', 0.9, 1.7],
            ['.', 1.7, 1.7],
            ['Yes', 2.1, 3.8],
            ['!', 3.8, 3.8],
          ]),
        },
      ],
      turns: [
        { startTime: 0, endTime: 1.9, cluster: 'S1' },
        { startTime: 2, endTime: 4, cluster: 'S2' },
      ],
    });

    expect(result.segments.map((segment) => segment.text)).toEqual([
      'Hello, world.',
      'Yes!',
    ]);
  });

  it('falls back to Them when supported coverage is below the trust threshold', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 4, speaker: 'Them', text: 'long first turn' },
        { startTime: 4, endTime: 8, speaker: 'Them', text: 'long second turn' },
      ],
      turns: [
        { startTime: 0, endTime: 1.1, cluster: 'S1' },
        { startTime: 4, endTime: 5.1, cluster: 'S2' },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.segments.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Them',
    ]);
    expect(result.metadata).toMatchObject({
      attempted: true,
      applied: false,
      fallbackReason: 'low_coverage',
    });
  });

  it('falls back to Them for a single established remote speaker', () => {
    const result = applyRemoteSpeakerClusters({
      segments: [
        { startTime: 0, endTime: 3, speaker: 'Them', text: 'only speaker' },
      ],
      turns: [{ startTime: 0, endTime: 3, cluster: 'S1' }],
    });

    expect(result.applied).toBe(false);
    expect(result.metadata.fallbackReason).toBe('not_enough_speakers');
    expect(result.segments[0].speaker).toBe('Them');
  });
});
